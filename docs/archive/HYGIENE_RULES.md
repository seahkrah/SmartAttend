# =============================================================================
# Repository Hygiene Configuration
# =============================================================================
# This file documents the enforcement rules for repository integrity.
# Copy contents to .git/config to enable enforcement.

[core]
    # Prevent large files from being committed
    protectNTFS = true
    
    # Use LF line endings (POSIX standard)
    safecrlf = true
    eol = lf
    
    # Long path support (important for Windows)
    longpaths = true

[push]
    # Require explicit branch specification
    default = simple
    
    # Reject force-push to main/master
    followTags = true

[pull]
    # Rebase by default to avoid merge commits
    rebase = true

[branch "main"]
    # Require review before merge (configure in hosting platform)
    description = "Production branch — no direct commits allowed"

[branch "develop"]  
    # Development integration branch
    description = "Development branch — all features must pass CI/CD"

# =============================================================================
# STRICT RULES (enforced via pre-commit hook)
# =============================================================================
# The following are FORBIDDEN in any commit:
#
# 1. Runtime artifacts:
#    - node_modules/ (install via npm ci from package-lock.json)
#    - .venv/ (install via python -m venv)
#    - __pycache__/ (Python cache)
#    - *.egg-info/ (Python packaging)
#
# 2. Build outputs:
#    - dist/ (rebuild from source)
#    - build/ (rebuild from source)
#    - *.o, *.so, *.dylib (rebuild from source)
#
# 3. Logs:
#    - *.log (never commit logs)
#    - logs/ (never commit log directories)
#
# 4. Secrets:
#    - .env* (use environment variables)
#    - *.secret (never commit secrets)
#    - *.private (never commit private keys)
#
# 5. Lock files without source changes:
#    - Uncommitted package-lock.json changes must be paired with package.json
#    - This prevents accidental lock file pollution
#
# =============================================================================
# SOURCE OF TRUTH (MUST be committed)
# =============================================================================
# The following are the ONLY sources allowed to generate other files:
#
# Manifests (dependency declarations):
#   - package.json (Node.js dependencies)
#   - package-lock.json (Node.js lock)
#   - requirements.txt (Python dependencies)
#   - Pipfile / Pipfile.lock (Python lock)
#
# Configuration:
#   - tsconfig.json (TypeScript)
#   - Dockerfile (container image)
#   - docker-compose.yml (container orchestration)
#   - .dockerignore (reduce image size)
#
# Any file derived from these may be regenerated and should never be committed.
#
# =============================================================================
# RECOVERY PROCEDURES
# =============================================================================
#
# If you accidentally committed artifacts:
#
# 1. Remove from current commit (before push):
#    git rm --cached <path>
#    git commit --amend
#    echo "<path>" >> .gitignore
#    git add .gitignore
#    git commit --amend
#
# 2. Remove from all history (if already pushed):
#    git filter-branch --tree-filter 'rm -rf <path>' HEAD
#    git push --force-with-lease origin main
#    (WARNING: force-push requires careful coordination)
#
# 3. Verify removal:
#    git check-ignore -v <path>
#    git log --all --oneline -- <path>
#
# =============================================================================
