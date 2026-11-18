# Morgan Autonomous Financial Agent 24/7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate the autonomous 24/7 Morgan CFO agent on the backend (`server.js` + `db.js`) with Gemini Function Calling (12 operational tools), Hybrid Governance (`Undo` snapshots + pre-confirmation inline buttons), Telegram Bot Official (Text, Voice Audio, Receipt Images) + WhatsApp Webhook Gateway, Proactive Daily Briefing Scheduler, and real-time SSE synchronization with the Family Money Web App.

**Architecture:** Modular Node.js backend extensions (`morgan-finance-engine.js`, `morgan-agent.js`, `morgan-telegram.js`, `morgan-scheduler.js`) sharing the existing hybrid PostgreSQL / Local JSON persistence layer (`db.js`) and real-time SSE hub (`broadcastDbChange` in `server.js`).

**Tech Stack:** Node.js (native `fetch`), Express.js, PostgreSQL (`pg`) / Local JSON hybrid, Google Gemini REST API (`v1beta` with `tools` Function Calling & Multimodal `inlineData`), Telegram Bot HTTP API (Long Polling + Inline Keyboards).

**Spec:** `docs/superpowers/specs/2026-11-18-morgan-autonomous-agent-design.md`

## Global Constraints

- Zero external npm dependency bloat: use Node.js native `fetch` for Gemini and Telegram Bot APIs so deployment on Hetzner/Coolify works without native binary build issues.
- Every database mutation triggered by Morgan MUST invoke `broadcastDbChange(table, action, data)` so open web/mobile dashboards update live via SSE.
- Hybrid Governance: daily entries (`create_transaction`, `conciliate_transaction`, `create_fixed_item`, `save_family_memory_fact`) execute immediately and generate an undoable snapshot in `morgan_action_logs`; high-risk operations (`delete_transaction`, `pay_card_bill`, `adjust_account_balance`, and `transfer_between_accounts` above `approval_threshold`) create a `pending_confirmation` action log requiring explicit user confirmation via Telegram or Web UI buttons.

---

### Task 1: Expand Database Schema and Hybrid Persistence (`db.js` & `schema.sql`)

**Files:**
- Modify: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\db.js`
- Modify: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\schema.sql`

- [ ] **Step 1: Add `morgan_settings`, `morgan_conversations`, and `morgan_action_logs` to `MANAGED_TABLES`, `initPostgresSchema()`, and default seed initialization in `db.js` and `schema.sql`.**
- [ ] **Step 2: Add helper methods `getMorganSettings()` and `updateMorganSettings(patch)` in `db.js`.**

---

### Task 2: Create Shared Financial & Transactional Engine (`morgan-finance-engine.js`)

**Files:**
- Create: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\morgan-finance-engine.js`

- [ ] **Step 1: Implement exact financial analytics functions (`getCardPaymentMonthAndYear`, `calculateForecast`, `calculateFinancialHealthScore`, `getCardsFloatAnalysis`, `detectExpenseAnomalies`, `buildMorganRichContext`).**
- [ ] **Step 2: Implement transactional operations with Hybrid Governance (`executeToolAction`, `confirmPendingAction`, `cancelPendingAction`, `undoExecutedAction`) that record `morgan_action_logs` with `undo_snapshot_json` and trigger `onMutation` (SSE broadcast).**

---

### Task 3: Create Morgan Cognitive Agent Core with Gemini Function Calling & Multimodal Support (`morgan-agent.js`)

**Files:**
- Create: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\morgan-agent.js`

- [ ] **Step 1: Define the 12 Gemini `functionDeclarations` (`create_transaction`, `transfer_between_accounts`, `conciliate_transaction`, `delete_transaction`, `adjust_account_balance`, `pay_card_bill`, `create_fixed_item`, `query_financial_data`, `recommend_best_card`, `simulate_purchase_impact`, `save_family_memory_fact`, `generate_executive_briefing`).**
- [ ] **Step 2: Implement the multi-step agent loop (`processMorganMessage`) supporting text, voice audio (`inlineData` `audio/ogg`), and receipt photos (`image/jpeg`), plus an intelligent local natural-language parser fallback when Gemini API key is not yet configured.**
- [ ] **Step 3: Implement `generateMorningBriefingReport()` for proactive daily briefings and card closing/due alerts.**

---

### Task 4: Create Telegram Bot Gateway, WhatsApp Webhook Adapter & Proactive Scheduler (`morgan-telegram.js` & `morgan-scheduler.js`)

**Files:**
- Create: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\morgan-telegram.js`
- Create: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\morgan-scheduler.js`

- [ ] **Step 1: Build resilient Telegram Bot Long Polling controller in `morgan-telegram.js` with dynamic token hot-reload, PIN pairing (`/parear 1202`), voice/photo download, and inline keyboard callbacks (`undo:<id>`, `confirm:<id>`, `cancel:<id>`, `conciliate:<txId>`, `quick:briefing`, `quick:cards`, `quick:balances`).**
- [ ] **Step 2: Build proactive cron scheduler in `morgan-scheduler.js` checking every 60s (`America/Sao_Paulo`) for Morning Briefing time and proactive card closing/due alerts.**

---

### Task 5: Wire Routes in `server.js` and Upgrade Frontend (`public/index.html` & `public/app.js`)

**Files:**
- Modify: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\server.js`
- Modify: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\public\index.html`
- Modify: `C:\Users\fbdv1\.gemini\antigravity\scratch\app-financeiro\public\app.js`

- [ ] **Step 1: Register `/api/morgan/status`, `/api/morgan/settings`, `/api/morgan/chat`, `/api/morgan/action/:id/:op`, `/api/morgan/briefing/send`, `/api/morgan/logs`, and `/api/morgan/webhook/whatsapp` in `server.js`.**
- [ ] **Step 2: Upgrade `#ai-settings-modal` and `#ai-memory-modal` in `public/index.html` and `public/app.js` to configure Telegram Bot Token, Chat IDs, Morning Briefing schedule, Hybrid Governance threshold, and connect the Web App chat directly to `/api/morgan/chat` with interactive Confirm/Undo action buttons.**
- [ ] **Step 3: Write and execute comprehensive end-to-end integration tests verifying all 12 tools, hybrid governance confirmation, one-click undo, balance updates, SSE broadcast, and Telegram bot formatting.**
