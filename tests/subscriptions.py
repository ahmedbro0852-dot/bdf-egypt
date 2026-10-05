"""Real HTTP tests for manual subscription issuance and signed license checks."""
import os, unittest, threading, json, time, hmac, hashlib
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from api.subscription import handler,verify_license,encode,PLANS

class Subscriptions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ['LICENSE_SIGNING_SECRET']='test-signing-secret-only'
        os.environ['SUBSCRIPTION_ADMIN_SECRET']='test-admin-only'
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
        cls.url='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def post(self,data,admin=''):
        req=Request(self.url,data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+admin,'Content-Type':'application/json'})
        try:
            with urlopen(req) as response:return response.status,json.load(response)
        except HTTPError as err:return err.code,json.load(err)
    def test_authorized_issue_all_plans(self):
        for plan in PLANS:
            status,data=self.post({'action':'issue',**plan,'paid':plan['price'],'reference':'synthetic-test-payment','confirmed':True},'test-admin-only')
            self.assertEqual(status,200)
            payload=verify_license(data['token'])
            self.assertEqual(payload['months'],plan['months'])
            self.assertGreater(payload['expires'],time.time()+28*86400)
            self.assertEqual(self.post({'action':'verify','token':data['token']})[0],200)
    def test_wrong_admin_price_or_unconfirmed(self):
        data={'action':'issue','months':1,'paid':19,'reference':'test-ref','confirmed':True}
        self.assertEqual(self.post(data,'wrong')[0],401)
        self.assertEqual(self.post({**data,'paid':1},'test-admin-only')[0],400)
        self.assertEqual(self.post({**data,'confirmed':False},'test-admin-only')[0],400)
    def test_expired_and_tampered(self):
        body=encode(json.dumps({'version':1,'months':1,'expires':1}).encode())
        signed=body+'.'+encode(hmac.new(b'test-signing-secret-only',body.encode(),hashlib.sha256).digest())
        self.assertEqual(self.post({'action':'verify','token':signed})[0],400)
        self.assertEqual(self.post({'action':'verify','token':signed+'x'})[0],400)
if __name__=='__main__':unittest.main()
