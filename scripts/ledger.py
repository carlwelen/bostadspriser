"""Tiny docs/backlog.md editor used by the orchestrator.

Usage from the repo root:
    python3 - <<'PY'
    exec(open('scripts/ledger.py').read())
    setrow('B21', 'done', sha('(B21)'), 'note')   # status / commit / note; None keeps a cell
    insert_before('B13', '| B99 | P2 | B | todo | acceptance | | notes |')
    save()
    PY
"""
import re, subprocess, sys
P = 'docs/backlog.md'
s = open(P).read()
def sha(grep):
    return subprocess.check_output(['git','log','--format=%h','-1','-F','--grep',grep]).decode().strip()
def setrow(i, status=None, commit=None, note=None):
    global s
    m = re.search(rf'^\| {re.escape(i)} \|.*\|$', s, flags=re.M)
    if not m: raise SystemExit(f'no row {i}')
    cells = [c.strip() for c in m.group(0).strip('|').split('|')]
    if status: cells[3] = status
    if commit: cells[5] = commit
    if note is not None: cells[6] = note
    s = s.replace(m.group(0), '| ' + ' | '.join(cells) + ' |')
def insert_before(anchor_id, rows):
    global s
    m = re.search(rf'^\| {re.escape(anchor_id)} \|', s, flags=re.M)
    s = s[:m.start()] + rows.strip('\n') + '\n' + s[m.start():]
def save():
    open(P, 'w').write(s)
