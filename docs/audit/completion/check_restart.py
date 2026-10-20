"""Check persistence on the dedicated completion stand, never on startup DB."""
import pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[3]
base=['docker','compose','-p','startup_completion_20261020','-f','docs/audit/completion/compose.yaml']
query="SELECT (SELECT count(*) FROM startups),(SELECT count(*) FROM applications),(SELECT count(*) FROM application_attempts),(SELECT count(*) FROM offers),(SELECT count(*) FROM startup_members),(SELECT count(*) FROM recruiter_grants),(SELECT count(*) FROM test_submissions),(SELECT count(*) FROM notifications),(SELECT count(*) FROM sessions);"
def call(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def counts():return call(base+['exec','-T','db','psql','-U','startup','-d','startup_test_ui_completion','-At','-c',query],capture_output=True,text=True).stdout.strip()
before=counts()
call(base+['down'])
call(base+['up','-d'])
for _ in range(30):
 try:
  after=counts()
  if after==before:break
 except subprocess.CalledProcessError:pass
 time.sleep(1)
else:raise RuntimeError('Counts not preserved on dedicated test volume')
(root/'docs/audit/completion/restart.txt').write_text('Before: '+before+'\nAfter: '+after+'\nPASS: dedicated named volume survived removal and recreation of all three containers.\n')
print('PASS: persisted row counts unchanged:',after)
