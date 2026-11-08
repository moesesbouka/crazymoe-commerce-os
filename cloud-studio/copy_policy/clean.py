"""Machine copy contains product facts only. Human-entered text bypasses this policy."""
import json,re
from pathlib import Path
RULES=json.loads(Path(__file__).with_name('policy.json').read_text())
RX={k:re.compile(v,re.I) for k,v in RULES.items()}
def sentences(text):return [s.strip() for s in re.split(r'(?<=[.!?;])\s+',text) if s.strip()]
def clean(text,kind='description',protected=()):
 text=str(text or '')
 if kind=='title':return RX['title_suffix'].sub('',text).rstrip(' -–—')
 output=[];private=False;changed=False
 for line in text.split('\n'):
  if line.strip() in protected:
   output.append(line);continue
  head=re.sub(r'^[^A-Za-z0-9]+','',line.strip())
  if RX['public_section'].search(head):private=False
  elif RX['private_section'].search(head):private=True
  if private or RX['drop_line'].search(head):
   changed=changed or bool(line.strip())
   continue
  original=line
  def parenthetical(m):
   parts=[s.rstrip(';') for s in sentences(m[0][1:-1]) if not RX['assessment'].search(s)]
   return '('+' '.join(parts)+')' if parts else ''
  line=re.sub(r'\([^()]*\)',parenthetical,line)
  kept=[]
  for sentence in sentences(line):
   if sentence in protected:kept.append(sentence);continue
   if RX['assessment'].search(sentence) or RX['photo_comment'].search(re.sub(r'^[^A-Za-z0-9]+','',sentence)):continue
   kept.append(sentence)
  if kept==sentences(original):
   output.append(original);continue
  changed=True
  line=' '.join(kept).strip()
  if not line and head:continue
  if line:line=re.sub(r'[ ;]+$','',line);line=re.sub(r'\s+([.,;:])',r'\1',line)
  output.append(line)
 return re.sub(r'\n{3,}','\n\n','\n'.join(output)).strip() if changed else text
