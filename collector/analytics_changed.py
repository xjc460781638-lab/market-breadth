"""Whether daily public observations changed (ignore collection heartbeat timestamps)."""
import json,subprocess
from pathlib import Path

def observations(report):
 return {k:{f:report.get(k,{}).get(f) for f in ['asOf','rows']} for k in ['turnover','flow','margin']}
if __name__=='__main__':
 current=json.loads(Path('data/analytics.json').read_text(encoding='utf-8'))
 previous=subprocess.run(['git','show','HEAD:data/analytics.json'],capture_output=True,text=True,encoding='utf-8')
 changed=previous.returncode!=0 or observations(current)!=observations(json.loads(previous.stdout))
 print('changed' if changed else 'unchanged')
