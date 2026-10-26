import importlib.util,json,pathlib,tempfile,zipfile,sys
spec=importlib.util.spec_from_file_location('shared',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='sumit-import-test-') as tmp:
 root=pathlib.Path(tmp)
 def bundle(name,entries):
  p=root/(name+'.zip')
  with zipfile.ZipFile(p,'w') as z:
   for n,v in entries.items():z.writestr(n,v)
  return p
 for legacy in [False,True]:
  entries={'files/page.html':'<h1>question</h1>','files/fonts/math.woff2':'FONT'}
  entries.update({'פתח את הסיכום.html':'<a href="files/page.html">open</a>'} if legacy else {'sumit-share.json':json.dumps({'entry':'files/page.html'})})
  result=module.unpack(bundle(str(legacy),entries),root/str(legacy))
  assert pathlib.Path(result).read_text()=='<h1>question</h1>'
 for name,entries in [('traversal',{'../escape.html':'bad'}),('duplicate',{'a.html':'a','A.html':'b'}),('entry',{'sumit-share.json':json.dumps({'entry':'../outside.html'})})]:
  try:module.unpack(bundle(name,entries),root/name)
  except (ValueError,FileNotFoundError):pass
  else:raise AssertionError(name+' must be rejected')
 assert not (root/'escape.html').exists()
 print('PASS portable import: current + legacy bundle, fonts, traversal/duplicate/outside-entry rejection')
