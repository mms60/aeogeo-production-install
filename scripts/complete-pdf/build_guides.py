"""Build the browser PDF guide module from its reviewed source data.

This does not deploy, inspect websites, or change audit scores. The generated
module is checked in under site/assets/ because Netlify publishes that folder.
"""
import json
import sys
from pathlib import Path

here=Path(__file__).resolve().parent
root=here.parent.parent
catalog=json.loads((here/'implementation-guides.json').read_text(encoding='utf-8'))
playbook=json.loads((here/'report-playbook.json').read_text(encoding='utf-8'))
template=(here/'guides-runtime.in.js').read_text(encoding='utf-8')
if len(catalog)!=22 or template.count('__GUIDES_JSON__')!=1 or template.count('__PLAYBOOK_JSON__')!=1:
    raise SystemExit('Unexpected guide catalog or module template; review before building.')
# The same module can also be embedded in an HTML viewer. Escape '<' so a
# closing script tag in an example cannot terminate the script element.
def js_json(value):
    return json.dumps(value,ensure_ascii=True,separators=(',',':')).replace('<',r'\u003c')
source=template.replace('__GUIDES_JSON__',js_json(catalog)).replace('__PLAYBOOK_JSON__',js_json(playbook))
out=root/'site/assets/implementation-guides.js'
if '--check' in sys.argv:
    if not out.exists() or out.read_text(encoding='utf-8')!=source:
        raise SystemExit('Generated PDF guide module is stale; run python scripts/complete-pdf/build_guides.py.')
    print('Complete PDF guide module is current.')
else:
    out.write_text(source,encoding='utf-8')
    print(f'Built complete PDF guides for {len(catalog)} checks and {len(playbook)} tutorials.')
