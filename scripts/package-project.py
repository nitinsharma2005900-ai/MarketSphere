"""Package source and actual evidence, excluding secrets, runtimes and dependency trees."""
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
archive = root / "MarketSphere_Complete_Project.zip"
excluded_dirs = {"node_modules", ".git", ".next", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".runtime", "dist", "test-results", "playwright-report", "build", "marketsphere_processing.egg-info"}
files = []
for current, directories, filenames in os.walk(root):
    directories[:] = [d for d in directories if d not in excluded_dirs]
    for name in filenames:
        path = Path(current) / name
        if name.startswith(".env") and not name.endswith(".example"):
            continue
        if name.endswith((".zip", ".pyc", ".tsbuildinfo", ".log")) or name == ".coverage":
            if path.parent != root / "docs" / "evidence" / "checks":
                continue
        if path == archive or name == "package-manifest.json":
            continue
        files.append(path)
required = ["README.md", "package-lock.json", "database/schema.prisma", "docker-compose.yml", "docs/MarketSphere_Project_Documentation.pdf", "docs/assessments/traceability.md", "docs/evidence/capstone.json", "docs/evidence/vitest-results.json", "docs/evidence/python-results.xml", "docs/evidence/playwright-results.json", "docs/openapi.json", "postman/MarketSphere.postman_collection.json", ".env.example", ".github/workflows/ci.yml"]
relative_names = {p.relative_to(root).as_posix() for p in files}
assert set(required).issubset(relative_names), f"Missing required artifacts: {set(required) - relative_names}"
manifest = root / "docs/evidence/package-manifest.json"
manifest.write_text(json.dumps({"required": required, "files": [{"path": p.relative_to(root).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files)]}, indent=2), encoding="utf-8")
files.append(manifest)
with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=7) as output:
    for path in files:
        output.write(path, path.relative_to(root).as_posix())
with ZipFile(archive) as output:
    assert output.testzip() is None
    assert set(required).issubset(set(output.namelist()))
    assert not any("node_modules/" in n or "/.venv/" in n or n == ".env" or n == ".env.test" for n in output.namelist())
print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "entries": len(files), "crc_check": "passed", "required_files": "present", "secret_exclusions": "passed"}, indent=2))
