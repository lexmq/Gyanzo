#!/usr/bin/env python3
"""Re-quote the pf* values inserted by add_profile_i18n.py (they lost their
single quotes). Regenerates each inserted line from the same key table."""
import re
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from add_profile_i18n import KEYS, LANGS  # noqa: E402

BASE = Path('/home/z/my-project/src/lib/i18n')

for i, lang in enumerate(LANGS):
    path = BASE / f'{lang}.ts'
    src = path.read_text(encoding='utf-8')
    fixed = 0
    for key, *vals in KEYS:
        val = vals[i]
        if val.startswith('(email: string)'):
            line = f'\\g<1>{key}: {val},'
        else:
            line = f"\\g<1>{key}: '{val}',"
        pat = re.compile(rf'^(\s*){key}: .*$', re.M)
        src, n = pat.subn(line, src)
        fixed += n
    path.write_text(src, encoding='utf-8')
    print(f'{lang}: re-quoted {fixed}/{len(KEYS)} lines')

print('DONE')
