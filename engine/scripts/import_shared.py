"""Import a SumIT bundle without touching existing summaries or following archive paths."""
import html,json,pathlib,re,stat,sys,urllib.parse,zipfile
def unpack(archive,destination):
 root=pathlib.Path(destination).resolve();root.mkdir(parents=True,exist_ok=False)
 allowed={'.html','.htm','.pdf','.css','.js','.png','.jpg','.jpeg','.gif','.svg','.webp','.ico','.woff','.woff2','.ttf','.otf','.eot','.txt','.json'}
 total=0;seen=set()
 with zipfile.ZipFile(archive) as z:
  if len(z.infolist())>3000:raise ValueError('Too many files')
  for e in z.infolist():
   name=e.filename.replace('\\','/');p=pathlib.PurePosixPath(name)
   if p.is_absolute() or ':' in name or '..' in p.parts or any(x.endswith(('.', ' ')) for x in p.parts) or stat.S_ISLNK(e.external_attr>>16):raise ValueError('Unsafe archive path')
   target=(root/name).resolve();key=str(target).casefold()
   if not target.is_relative_to(root) or key in seen:raise ValueError('Duplicate or outside path')
   seen.add(key)
   if e.is_dir():target.mkdir(parents=True,exist_ok=True);continue
   if target.suffix.lower() not in allowed:raise ValueError('Unsupported file type')
   total+=e.file_size
   if total>300*1024*1024:raise ValueError('Archive too large')
   target.parent.mkdir(parents=True,exist_ok=True)
   with z.open(e) as source,target.open('xb') as output:
    written=0
    while chunk:=source.read(81920):
     written+=len(chunk)
     if written>e.file_size:raise ValueError('Invalid size')
     output.write(chunk)
 manifest=root/'sumit-share.json';launcher=root/'פתח את הסיכום.html'
 if manifest.exists():entry=json.loads(manifest.read_text(encoding='utf-8-sig'))['entry']
 else:
  m=re.search(r'''href=["']([^"']+)''',launcher.read_text(encoding='utf-8-sig'),re.I)
  if not m:raise ValueError('No summary entry')
  entry=html.unescape(m[1])
 page=(root/urllib.parse.unquote(entry).replace('\\','/')).resolve()
 if not page.is_relative_to(root) or not page.is_file() or page.suffix.lower() not in {'.html','.htm'}:raise ValueError('Invalid summary entry')
 return str(page)
if __name__=='__main__':print(unpack(sys.argv[1],sys.argv[2]))
