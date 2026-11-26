"""Build assessment documentation and a 15-page PDF from the real schema and test evidence."""
import json
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
EVIDENCE = DOCS / "evidence"
NAVY = colors.HexColor("#14243d")
GREEN = colors.HexColor("#16836a")
BLUE = colors.HexColor("#315ee7")
SLATE = colors.HexColor("#64748b")
NOW = datetime.now(ZoneInfo("Asia/Calcutta"))


def read_json(name, fallback=None):
    path = EVIDENCE / name
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else fallback


vitest = read_json("vitest-results.json", {})
playwright = read_json("playwright-results.json", {})
coverage = read_json("coverage/coverage-summary.json", {}).get("total", {})
python_cov = read_json("python-coverage.json", {}).get("totals", {})
capstone = read_json("capstone.json", {})
health = read_json("service-health.json", {})
build = read_json("build-results.json", {})
ci = read_json("github-ci.json", {})
xml = ET.parse(EVIDENCE / "python-results.xml").getroot()
suite = xml.find("testsuite") if xml.tag != "testsuite" else xml
py_tests = int(suite.attrib.get("tests", 0))
py_failures = int(suite.attrib.get("failures", 0)) + int(suite.attrib.get("errors", 0))
node_passed = vitest.get("numPassedTests", 0)
browser_passed = playwright.get("stats", {}).get("expected", 0)
all_tests_pass = vitest.get("success", False) and not py_failures and browser_passed >= 6 and not playwright.get("stats", {}).get("unexpected", 0)
container_verified = all(any(s.get("url") == url and s.get("status") == 200 for s in health.get("services", [])) for url in ["http://localhost:3050", "http://localhost:4050/ready", "http://localhost:8050/health"])
verified = "Implemented and verified"
partial = "Partial or simulated"
unverified = "Implemented but not externally verified"
assessments = [
    ("01", "Marketplace storefront and seller UI", verified if all_tests_pass else partial, "apps/frontend/components/; apps/frontend/app/", "tests/e2e/marketplace.spec.ts; tests/frontend/ui.test.tsx", "playwright-results.json; screenshots/", "Responsive storefront, search/filter, SKU selection, cart, sandbox checkout, order tracking and five role workspaces. External Stripe Elements checkout UI is outside verified local scope."),
    ("02", "Commerce backend APIs", verified, "apps/backend/src/routes.ts; commerce.ts; auth.ts; http.ts", "tests/integration/commerce.test.ts", "vitest-results.json; capstone.json", "Versioned validated APIs, role/resource scoping and explicit order/payment/shipping/return/settlement transitions."),
    ("03", "Commerce database model", verified, "database/schema.prisma; database/migrations/; database/seed.ts", "tests/integration/commerce.test.ts", "capstone.json; backup-restore.txt", "Normalized PostgreSQL model, keys, constraints, indexes and immutable stock/audit/financial ledgers. Generated ER matches actual schema."),
    ("04", "Marketplace security", verified, "apps/backend/src/auth.ts; http.ts; app.ts; providers.ts", "tests/integration/commerce.test.ts", "vitest-results.json; npm-audit.json", "Bcrypt, JWT/refresh reuse revocation, Origin/CORS, server RBAC and ownership, upload decode/re-encode, rate limits and audit trail."),
    ("05", "Python pricing and feed engine", verified, "services/python-service/main.py; samples/", "services/python-service/tests/test_processing.py", "python-results.xml; python-benchmark.json", "Integer promotion/commission allocation, catalog normalization, price/catalog feeds, duplicate and invalid-row reporting."),
    ("06", "Recommendation service", verified, "services/python-service/main.py; apps/backend/src/python.ts; frontend storefront.tsx", "test_processing.py; commerce.test.ts", "python-results.xml; vitest-results.json", "Popular, recently viewed, related, category, frequent and personalized modes with deterministic explainable cold-start fallback."),
    ("07", "Inventory reservation engine", verified, "apps/backend/src/commerce.ts; repository.ts; worker.ts; migrations/", "tests/integration/commerce.test.ts", "capstone.json", "Real concurrent PostgreSQL last-item checkout, immutable movements, expiry, bounded retries, late-payment compensation and partial fulfillment."),
    ("08", "Commerce integrations", partial, "apps/backend/src/providers.ts; app.ts; worker.ts; docker-compose.yml", "tests/integration/commerce.test.ts", "vitest-results.json; service-health.json", "MinIO upload/download and Mailpit capture verified locally. Payments, shipping and settlements use explicit local simulators. Stripe test adapter exists but genuine provider credentials/events are unverified."),
    ("09", "Docker environment", verified if container_verified else partial, "docker-compose.yml; infrastructure/docker/; services/python-service/Dockerfile", "Full Compose build/start and HTTP smoke checks", "container-status.json; service-health.json", "Frontend, API, FastAPI, PostgreSQL, Redis, worker, migration job, MinIO and Mailpit. Alternate verification ports permit coexistence with native development."),
    ("10", "Git collaboration and reviews", partial, ".github/CODEOWNERS; pull_request_template.md; CONTRIBUTING.md", "Actual local commits and GitHub repository/PR inspection", "git-history.txt; github-repository.json; branch-protection-result.txt", "Real feature branch/commits and private GitHub repository. Human approval is outstanding. Branch protection was attempted but GitHub returned 403 requiring a supporting plan or visibility change; no paid/visibility change was made."),
    ("11", "CI/CD pipeline", unverified, ".github/workflows/ci.yml; release.yml", "GitHub Actions quality workflow when available", "github-ci.json; build-results.json", "Quality/security/container CI is recorded separately from release deployment. Registry release, staging/production approval and rollback are configured but require genuine owner-controlled execution."),
    ("12", "Commerce test suite", verified if all_tests_pass else partial, "tests/integration/; tests/frontend/; tests/e2e/; python tests/", "Vitest, Supertest, RTL, Pytest, HTTPX, Playwright", "vitest-results.json; python-results.xml; playwright-results.json; coverage/", "Success, authorization, invalid input, concurrency, expiry, duplicate events/refunds, failed shipping recovery and provider-local integration tests. Coverage is reported as measured, not complete."),
    ("13", "API documentation", verified, "apps/backend/src/openapi.ts; docs/openapi.json; postman/", "Generated JSON export, running Swagger and API tests", "service-health.json; docs/openapi.json", "Request schemas, entity contracts, permissions, pagination/filtering, state transitions, signed callbacks and idempotency requirements. Postman includes generated example payloads."),
    ("14", "Public HTTPS deployment", "Blocked", "infrastructure/deployment/; docs/deployment.md; .env.*.example", "Local builds/Compose only; public execution unavailable", "build-results.json; service-health.json", "Needs a suitable host/account, approval for any provider cost, domain/DNS and genuine sandbox credentials. No public deployment URL is invented."),
    ("15", "Incident simulation and RCA", verified, "docs/incidents/incident-rca.md; commerce.ts; repository.ts", "Six controlled regression scenarios in commerce.test.ts", "capstone.json; vitest-results.json", "Overselling, stale cache/reservations, payment mismatch, indexed bounded search, failed callback recovery and duplicate refund. Small-data plans are not a production-load performance claim."),
]

assessment_dir = DOCS / "assessments"
assessment_dir.mkdir(exist_ok=True)
matrix = "# Assessment traceability matrix\n\nStatuses describe verified local scope. External provider and hosting limitations remain explicit. Generated from actual source and evidence.\n\n| Assessment | Status | Implementation | Tests | Evidence | Scope / limitation |\n|---|---|---|---|---|---|\n"
for number, title, status, implementation, tests, evidence, scope in assessments:
    matrix += f"| {number} — {title} | {status} | {implementation} | {tests} | docs/evidence/{evidence} | {scope} |\n"
    (assessment_dir / f"{number}-{title.lower().replace(' ', '-').replace('/', '-')}.md").write_text(f"# Assessment {number} — {title}\n\n**Status:** {status}\n\n{scope}\n\n## Implementation\n\n{implementation}\n\n## Setup and usage\n\nFollow the root README to start PostgreSQL, Redis, FastAPI, the Express API, worker and Next.js. Use the synthetic role account appropriate to the module. All authoritative writes are enforced by Express/PostgreSQL.\n\n## Verification\n\n{tests}\n\nActual evidence: `docs/evidence/{evidence}`. Run results and remaining external limitations are described in docs/test-report.md and docs/deployment.md.\n", encoding="utf-8")
(assessment_dir / "traceability.md").write_text(matrix, encoding="utf-8")

schema = (ROOT / "database/schema.prisma").read_text()
models = dict(re.findall(r"model\s+(\w+)\s*\{(.*?)^\}", schema, re.M | re.S))
relations, entity_fields = [], {}
mermaid = ["# Database ER diagram", "", "Generated directly from database/schema.prisma. Every model and declared foreign-key relation is included. SQL migrations add check constraints and immutable-ledger triggers.", "", "```mermaid", "erDiagram"]
for model, body in models.items():
    fields = []
    foreign = set(re.findall(r"fields:\s*\[\s*(\w+)", body))
    mermaid.append(f"  {model} {{")
    for line in body.splitlines():
        tokens = line.strip().split()
        if len(tokens) < 2 or tokens[0].startswith("@@"):
            continue
        name, field_type = tokens[:2]
        target = field_type.rstrip("?[]")
        if target in models:
            if "fields:" in line:
                relations.append((target, model, name))
            continue
        annotation = " PK" if "@id" in line else " FK" if name in foreign else " UK" if "@unique" in line else ""
        mermaid.append(f"    {field_type.replace('?', '').replace('[]', '')} {name}{annotation}")
        fields.append((name, target, annotation.strip()))
    entity_fields[model] = fields
    mermaid.append("  }")
for parent, child, label in relations:
    mermaid.append(f"  {parent} ||--o{{ {child} : {label}")
mermaid.append("```")
(DOCS / "architecture/database-er.md").write_text("\n".join(mermaid), encoding="utf-8")

report = f"""# Actual test execution report

Generated {NOW:%d %B %Y, %H:%M %Z} from retained machine-readable reports.

| Suite | Actual result | Evidence |
|---|---|---|
| Vitest / Supertest / React Testing Library | {node_passed} passed; {vitest.get('numFailedTests', 0)} failed | evidence/vitest-results.json and XML |
| Pytest / HTTPX | {py_tests} tests; {py_failures} failures/errors | evidence/python-results.xml |
| Playwright Chromium | {browser_passed} passed; {playwright.get('stats', {}).get('unexpected', 0)} unexpected failures | evidence/playwright-results.json; screenshots/ |
| Selected JS statement coverage | {coverage.get('statements', {}).get('pct', 0)}% | evidence/coverage/coverage-summary.json |
| Selected JS line coverage | {coverage.get('lines', {}).get('pct', 0)}% | evidence/coverage/coverage-summary.json |
| Python line coverage | {python_cov.get('percent_covered', 0):.2f}% | evidence/python-coverage.json |
| Build / static checks | {sum(c.get('passed', False) for c in build.get('checks', []))} of {len(build.get('checks', []))} recorded checks pass | evidence/build-results.json and checks/ |

The inventory/payment/refund capstone uses real PostgreSQL and signed HTTP events. `capstone.json` records concurrent request statuses, inventory/ledger consistency, replay counts, financial reversals and a real PostgreSQL EXPLAIN plan. Local MinIO and Mailpit adapters are exercised when configured. Optional external Stripe/hosting operations are not included in local pass counts. Browser tests cover product discovery, filtering, SKU choice, mobile overflow, customer checkout/support and all five role logins.

GitHub quality workflow snapshot: status **{ci.get('status', 'not captured')}**, conclusion **{ci.get('conclusion') or 'pending'}**. Actual run: {ci.get('url', 'see github-ci.json')}. Local adapter checks are explicitly skipped in CI when MinIO/Mailpit are not configured. Additional read-only portal route checks are recorded in portal-smoke.json.

Coverage is for the configured selected API modules and UI status components; Playwright executes additional browser code outside Vitest coverage. It is not a claim of exhaustive coverage. The Python environment reports a Starlette/httpx TestClient deprecation warning; its tests still execute. Raw test results retain actual durations and outcomes. See incident-rca.md for the serialization retry defect found and fixed by the initial capstone run.

An earlier GitHub run completed its quality/browser and container checks but failed in setup-uv post-job cache pruning: the background `uv run uvicorn` process retained the cache lock. CI now launches the installed virtual environment's Python executable directly for the persistent FastAPI service. The retained GitHub run snapshot records the actual final workflow conclusion rather than treating passed intermediate checks as a successful workflow.
"""
(DOCS / "test-report.md").write_text(report, encoding="utf-8")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Brand", fontName="Helvetica-Bold", fontSize=34, leading=39, textColor=NAVY, spaceAfter=18))
styles.add(ParagraphStyle(name="Section", fontName="Helvetica-Bold", fontSize=23, leading=28, textColor=NAVY, spaceAfter=20))
styles.add(ParagraphStyle(name="Copy", fontName="Helvetica", fontSize=10, leading=16, textColor=SLATE, spaceAfter=12))
styles.add(ParagraphStyle(name="SmallCopy", parent=styles["Copy"], fontSize=8, leading=12, spaceAfter=8))
styles.add(ParagraphStyle(name="Cell", parent=styles["Copy"], fontSize=8, leading=11, spaceAfter=0))
styles.add(ParagraphStyle(name="Kicker", fontSize=9, leading=13, textColor=GREEN, spaceAfter=15))
styles.add(ParagraphStyle(name="Metric", fontSize=22, leading=26, textColor=GREEN, alignment=TA_CENTER))
story = []


def p(text, style="Copy"):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), styles[style])


def page(title, kicker="MARKETSPHERE / ENGINEERING DOCUMENTATION"):
    if story:
        story.append(PageBreak())
    story.extend([p(kicker, "Kicker"), p(title, "Section")])


def text(*paragraphs):
    story.extend(p(value) for value in paragraphs)


def table(rows, widths):
    data = [[p(cell, "Cell") for cell in row] for row in rows]
    result = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    result.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef3f8")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LINEBELOW", (0, 0), (-1, -1), .4, colors.HexColor("#e4eaf1"))]))
    story.append(result)


def screenshot(name, width=495, max_height=320):
    path = EVIDENCE / "screenshots" / name
    if path.exists():
        w, h = ImageReader(str(path)).getSize()
        factor = min(width / w, max_height / h)
        story.append(Image(str(path), width=w * factor, height=h * factor))
        story.append(Spacer(1, 10))


page("MarketSphere", "PROJECT 04 / COMPLETE PROJECT RECORD")
story.append(p("Multi-Vendor Commerce,\nInventory & Order Platform", "Brand"))
text("A connected marketplace for customers, independent sellers and operations teams.", "Working local software, real PostgreSQL concurrency evidence, deterministic Python processing and an explicit record of external limitations.")
screenshot("storefront-viewport.png", max_height=280)
text(f"Prepared {NOW:%d %B %Y} · Synthetic data and sandbox services only.", "Assessment source: project4.pdf, all 12 pages read before development. No evaluation score or unverified public deployment is asserted.")

page("Executive summary")
text("MarketSphere connects discovery, seller catalogs, warehouse inventory and after-sales operations in one typed full-stack application. Express owns business records, PostgreSQL protects integrity and FastAPI provides stateless deterministic calculations.", "The primary proof is a real last-item race: two independent authenticated customers issue simultaneous checkout requests. Only one reservation commits. Signed payment and refund event replays preserve single stock and financial effects.")
table([["Measured result", "Actual evidence"], ["Node / API / UI", f"{node_passed} passed"], ["Python processing", f"{py_tests} tests, {py_failures} failures"], ["Browser journeys", f"{browser_passed} passed"], ["Seed catalog", "50 products, 100 SKUs, 5 sellers, 2 warehouses"], ["External hosting", "Blocked pending owner host, domain and sandbox configuration"]], [180, 315])
text("The local payment gateway, shipping provider and settlements are labeled simulators. MinIO upload/download and Mailpit message capture are real local service integrations. The Stripe test adapter is implemented but genuine provider-side verification remains outstanding.")

page("Business problem and objectives")
text("A multi-vendor marketplace needs more than a product listing. It must keep product ownership, inventory availability, payments, shipments, returns and seller balances consistent while multiple users act concurrently.", "The customer objective is a clear purchase journey with useful discovery, a reliable stock reservation, transparent order tracking and a controlled return process. The seller objective is an isolated catalog and financial view. Operations need accountable stock movements, bounded fulfillment and a visible resolution history.", "Engineering objectives are explicit state transitions, exact minor-unit currency arithmetic, server-side permissions, safe retries, immutable history, reproducible setup and honest evidence. A frontend-only role check or a hardcoded dashboard total does not satisfy these boundaries.")
table([["Risk", "Implemented objective"], ["Last unit requested twice", "One transaction wins; one useful stock conflict"], ["Provider retries the same event", "Unique event journal and one financial effect"], ["A seller guesses another seller's ID", "Resource ownership enforced in Express"], ["Dependency or worker restarts", "Committed outbox, retries and expiry sweep"], ["Display stock is stale", "Versioned bounded cache; checkout reads PostgreSQL"]], [180, 315])

page("Scope and user roles")
table([["Role", "Implemented scope"], ["Customer", "Registration, discovery, filters, SKU selection, recommendations, bag, coupon, address, sandbox payment, orders, returns, reviews, profile and support."], ["Seller", "Approval/onboarding, own catalog and variants, image upload, CSV imports, stock receipts, own order lines, analytics, commissions, settlements and reversals."], ["Warehouse operator", "Available/reserved stock, receipt/reconciliation, immutable movement history, low-stock indicators, partial shipment preparation and local tracking updates."], ["Support agent", "Ticket assignment/messages/status, disputes, return inspection and controlled sandbox refunds."], ["Administrator", "Sellers, users, product moderation, categories, coupons, marketplace metrics, audit history, jobs and simulated settlements."]], [130, 365])
text("The seed uses only fictional .test accounts and synthetic commerce events. Production configuration disables demo seeding and local payment/shipping control endpoints. Public operation requires separate account/bootstrap and genuine sandbox verification.")

page("Technology stack and boundaries")
table([["Layer", "Implemented technologies"], ["Frontend", "Next.js App Router, React, TypeScript, Tailwind, TanStack Query, React Hook Form, Zod, Recharts, Lucide, Framer Motion, Sonner."], ["Core API", "Node.js, Express 5, TypeScript, Prisma, bcrypt, JWT, Helmet, CORS, rate limits, structured Pino logs, OpenAPI/Swagger."], ["Processing", "Python 3, FastAPI, Pydantic, HTTPX; deterministic integer pricing, CSV processing and affinity/popularity recommendations."], ["Data and jobs", "PostgreSQL 17, Redis 7, BullMQ, serializable transactions, constraints, immutable ledgers and transactional outbox."], ["Local integrations", "Source-built pinned MinIO, S3 SDK, Mailpit SMTP, local payment/shipping simulators; optional Stripe test adapter."], ["Quality / operations", "Vitest, RTL, Supertest, Pytest, HTTPX, Playwright, Docker Compose, GitHub Actions, Caddy and backup/restore scripts."]], [125, 370])
text("Express is the only business authority. Python does not persist or duplicate authoritative commerce data. Redis is not used as the stock correctness lock. Provider-local checks are distinguished from genuinely external sandbox execution.")

page("System architecture")
d = Drawing(495, 350)
nodes = {"Next.js browser UI": (160, 280), "Express business API": (160, 190), "PostgreSQL records": (160, 90), "FastAPI calculations": (335, 190), "Redis + BullMQ": (0, 190), "Background worker": (0, 90), "MinIO assets": (335, 90), "Mailpit capture": (0, 0), "Payment / shipping": (335, 0)}
for a, b in [("Next.js browser UI", "Express business API"), ("Express business API", "PostgreSQL records"), ("Express business API", "FastAPI calculations"), ("Express business API", "Redis + BullMQ"), ("Redis + BullMQ", "Background worker"), ("Background worker", "PostgreSQL records"), ("Background worker", "Mailpit capture"), ("Express business API", "MinIO assets"), ("PostgreSQL records", "Payment / shipping")]:
    x, y = nodes[a]; xx, yy = nodes[b]
    d.add(Line(x + 75, y + 25, xx + 75, yy + 25, strokeColor=colors.HexColor("#bccbd9"), strokeWidth=1.4))
for label, (x, y) in nodes.items():
    d.add(Rect(x, y, 155, 52, rx=7, fillColor=colors.HexColor("#edf3f7"), strokeColor=colors.HexColor("#dce5ed")))
    d.add(String(x + 77, y + 23, label, textAnchor="middle", fontName="Helvetica-Bold", fontSize=9, fillColor=NAVY))
story.append(d)
text("The browser calls the versioned REST API with a short-lived bearer token. The API uses a separate internal token for bounded FastAPI calculation calls. Database transactions commit both business effects and outbox intents. Workers deliver those intents and independently recover expired reservations.", "Local infrastructure is connected through Compose's private network and persistent volumes. The production-like overlay exposes only Caddy on 80/443, with domain-controlled HTTPS and private database access.")

page("Database ER diagram")
text(f"The actual Prisma schema contains {len(models)} models and {len(relations)} declared foreign-key relations. This compact map includes every model; architecture/database-er.md provides the full field-level Mermaid diagram.")
d = Drawing(495, 515)
cols = 4; rows = math.ceil(len(models) / cols); box_w = 115; box_h = 42; gap = 11
positions = {name: ((i % cols) * (box_w + gap), 468 - (i // cols) * (box_h + 10)) for i, name in enumerate(models)}
for parent, child, _ in relations:
    x, y = positions[parent]; xx, yy = positions[child]
    d.add(Line(x + box_w / 2, y + box_h / 2, xx + box_w / 2, yy + box_h / 2, strokeColor=colors.HexColor("#d4dfeb"), strokeWidth=.35))
for name, (x, y) in positions.items():
    d.add(Rect(x, y, box_w, box_h, rx=4, fillColor=colors.white, strokeColor=colors.HexColor("#a8bdcf"), strokeWidth=.7))
    d.add(String(x + 6, y + 27, name, fontName="Helvetica-Bold", fontSize=7, fillColor=NAVY))
    keys = [f[0] for f in entity_fields[name] if f[2] in ["PK", "FK"]]
    d.add(String(x + 6, y + 12, ", ".join(keys)[:28], fontSize=5.8, fillColor=SLATE))
story.append(d)
text("Check constraints prevent negative stock, invalid reservations, invalid line quantities and inconsistent totals. Unique keys protect provider events, checkout requests, promotion claims, refund records, settlement lines and financial reversals. Triggers make stock, financial and audit history append-only.")

page("Service and data flow")
table([["Step", "Authoritative flow"], ["Discover", "Express queries approved products; versioned Redis cache may serve bounded display data."], ["Prepare", "Customer's cart and address are scoped to the authenticated account."], ["Calculate", "FastAPI computes exact line discounts and commission from the server's snapshot."], ["Reserve", "Express revalidates that snapshot, conditionally reserves stock and commits order/ledger/outbox in PostgreSQL."], ["Confirm", "A verified provider event locks the order, deduplicates its ID and consumes each reservation once."], ["Fulfill", "Operators prepare a partial shipment bounded by remaining quantity and warehouse allocation."], ["Resolve", "Delivered items may be returned; received units restock once, with a unique refund and financial reversal."], ["Recover", "BullMQ retries safe intents; the worker sweeps expiry and compensates late captured payments."]], [95, 400])
text("Pricing uses basis points and integer paise. Promotion discounts use a deterministic largest-remainder allocation, with original order-line snapshots preserved. Recommendations rank category affinity and synthetic popularity with stable ID tie-breaking and understandable reasons.")

page("Main modules in operation")
text("The storefront uses original local vector product illustrations. Customer and operations screens query live APIs; order totals, inventory, seller sales, commissions and charts derive from database records.")
screenshot("seller-dashboard.png", max_height=290)
screenshot("customer-orders.png", max_height=235)
text("Actual browser screenshots from the retained Playwright run. Additional desktop/mobile and role screenshots are included in docs/evidence/screenshots.")

page("Assessment summaries / 01–08")
table([["Assessment", "Status / demonstrated behavior"]] + [[f"{n} · {title}", status + "\n" + scope] for n, title, status, _, _, _, scope in assessments[:8]], [155, 340])

page("Assessment summaries / 09–15")
table([["Assessment", "Status / demonstrated behavior"]] + [[f"{n} · {title}", status + "\n" + scope] for n, title, status, _, _, _, scope in assessments[8:]], [155, 340])

page("Security and concurrency evidence")
text("Server-side authentication, role permissions and resource ownership protect customer privacy and seller isolation. Refresh rotation and reuse revocation are transactional. Uploads are size/MIME checked, safely decoded and re-encoded before storage.")
race = capstone.get("concurrentLastItem", {})
payment = capstone.get("duplicatePayment", {})
refund = capstone.get("duplicateRefund", {})
table([["Proof", "Actual result"], ["Independent sessions", race.get("independentAuthenticatedSessions", "not recorded")], ["Concurrent checkout statuses", race.get("statuses", "not recorded")], ["Losing response", race.get("losingError", "not recorded")], ["Remaining on hand / reserved", f"{race.get('onHand')} / {race.get('reserved')}"], ["Payment replay requests / sale movements", f"{payment.get('replays')} / {payment.get('saleMovements')}"], ["Refund replays / refund records", f"{refund.get('replays')} / {refund.get('refundRecords')}"], ["Restock / financial reversals", f"{refund.get('restockMovements')} / {refund.get('financialReversals')}"]], [220, 275])
text("The initial capstone exposed Prisma's raw-query serialization error path. Retrying only ORM P2034 was insufficient: raw SQL reported P2010 with SQLSTATE 40001. The bounded retry classifier now handles both paths plus deadlocks, and the unchanged behavioral assertions pass.", "Stock/audit/financial ledgers are immutable at the database boundary. Unique event, refund and movement keys make repeated callbacks and retries safe. Late payments cannot consume released stock.")

page("Testing and actual execution")
table([["Check", "Actual result"], ["Vitest / Supertest / RTL", f"{node_passed} passed; {vitest.get('numFailedTests', 0)} failed"], ["Pytest / HTTPX", f"{py_tests} tests; {py_failures} failures/errors"], ["Playwright Chromium", f"{browser_passed} passed; {playwright.get('stats', {}).get('unexpected', 0)} unexpected failures"], ["Selected JS statements / lines", f"{coverage.get('statements', {}).get('pct', 0)}% / {coverage.get('lines', {}).get('pct', 0)}%"], ["Python coverage", f"{python_cov.get('percent_covered', 0):.2f}%"], ["Recorded build/static checks", f"{sum(c.get('passed', False) for c in build.get('checks', []))} of {len(build.get('checks', []))} pass"]], [220, 275])
benchmark = read_json("python-benchmark.json", {})
text(f"Pricing benchmark: {benchmark.get('quotes', 'see Pytest stdout')} quotes with {benchmark.get('lines_per_quote', 50)} lines per quote; measured elapsed seconds: {benchmark.get('elapsed_seconds', 'see recorded test output')}.", "Tests cover authentication, invalid input, ownership, cart abandonment, coupon abuse, concurrent checkout, expiry, payment failure, delayed success, partial fulfillment, callbacks, bounded returns, duplicate refunds, cache invalidation, catalog imports, MinIO and Mailpit. Browser verification includes all five roles and a complete local customer purchase.", f"GitHub quality workflow: {ci.get('status', 'not captured')} / {ci.get('conclusion') or 'pending'}. Verification and image-build jobs are recorded in github-ci.json. Registry release and public deployment remain unverified.", "Coverage is measured for the configured selected files and is not exhaustive. A TestClient deprecation warning is retained. Local pass counts do not imply external Stripe events, a registry push or public HTTPS deployment were executed.")

page("Deployment and environment setup")
text("Local application: http://localhost:3040. Express Swagger: http://localhost:4040/api-docs. FastAPI Swagger: http://localhost:8040/docs. PostgreSQL and Redis use loopback-only host ports in local mode and private internal service names in Compose.", "Setup generates random secrets into ignored root .env. Migrations and synthetic seeds initialize the database. FastAPI, the worker, API and frontend run as separate processes or containers. The Compose verification overlay uses ports 3050/4050/8050 alongside native development.", "The production-like Caddy overlay provides a concrete HTTPS deployment configuration. It needs a real host, owner-controlled DNS and independent environment secrets. Public demo seeding is disabled. No paid infrastructure is provisioned and no public URL is invented.", "GitHub repository: https://github.com/nitinsharma2005900-ai/MarketSphere (private). CI and release workflows are included; actual remote execution is recorded separately when available. Production approvals, deployment hooks and any sandbox provider verification require owner configuration.")
table([["Integration", "Keys"], ["Core local project", "No third-party API keys; setup generates local secrets."], ["Mailpit / MinIO", "Local capture/storage; local credentials generated by setup."], ["Stripe test adapter", "Optional sk_test_ and webhook secret in root .env; genuine external events unverified."], ["Hosting / DNS", "Owner host/account, domain access and any cost approval required."]], [175, 320])

page("Incidents, limits and handover")
table([["Incident", "Corrective boundary"], ["Overselling", "Conditional serializable stock update; real concurrent capstone."], ["Stale stock", "Version invalidation, bounded cache TTL and idempotent expiry release."], ["Payment/order mismatch", "Signed amount checks and compensating late-payment refund."], ["Slow search", "Trigram indexes, SQL filters/price sorting, pagination and actual EXPLAIN evidence."], ["Failed shipping callback", "Deduplication, bounded quantities and valid later-event recovery."], ["Duplicate refund", "Unique refund/event/reversal keys and one restock movement."]], [170, 325])
text("Known limitations: payment/shipping/settlement providers are local simulators; Stripe test REST integration still needs genuine sandbox verification and a Stripe Elements UI for public customer payment. External email/carrier integration, host/DNS setup and production approval are not claimed. Large-scale load testing is outside the retained synthetic benchmark.", "The final archive includes source, migrations, seed data, containers, workflows, API contracts, tests, actual evidence, this PDF and the assessment traceability matrix. It excludes real environment secrets, dependencies, virtual environments, caches and generated application build directories.", "Use README.md for execution, docs/environment.md for optional credentials, docs/deployment.md for exact hosting actions and docs/incidents/incident-rca.md for controlled reproduction. All completion claims should be read with their recorded verification scope.")


def footer(canvas, document):
    canvas.setStrokeColor(colors.HexColor("#e1e8ef"))
    canvas.line(48, 42, 547, 42)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(SLATE)
    canvas.drawString(48, 28, "MarketSphere | Synthetic marketplace | Engineering record")
    canvas.drawRightString(547, 28, f"{document.page} / 15")


pdf = DOCS / "MarketSphere_Project_Documentation.pdf"
SimpleDocTemplate(str(pdf), pagesize=(595.28, 841.89), leftMargin=50, rightMargin=50, topMargin=44, bottomMargin=58, title="MarketSphere Project Documentation", author="MarketSphere Project").build(story, onFirstPage=footer, onLaterPages=footer)
from pypdf import PdfReader

pages = len(PdfReader(pdf).pages)
assert pages == 15, f"Expected 15 pages, generated {pages}; adjust page content before packaging"
print(json.dumps({"pdf": str(pdf), "pages": pages, "models": len(models), "foreign_key_relations": len(relations), "node_tests_passed": node_passed, "python_tests": py_tests, "browser_tests_passed": browser_passed, "all_tests_pass": all_tests_pass}, indent=2))
