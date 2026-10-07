import io
import json
import unittest
from urllib.error import HTTPError
from api.ai_review import request_review, ReviewFailure

class ReviewTests(unittest.TestCase):
    def run_review(self, responses):
        self.calls=[]
        def opener(req, timeout):
            self.calls.append((json.loads(req.data), timeout))
            item=responses.pop(0)
            if isinstance(item, Exception):raise item
            return io.StringIO(json.dumps(item))
        return request_review('https://example.invalid','test',{'max_tokens':6500,'messages':[]},opener)
    def result(self, content=None, reason='stop'):
        return {'choices':[{'finish_reason':reason,'message':{'content':content or json.dumps({'fields':[{'label':'الاسم'}],'coverage':{'complete':True}})}}]}
    def test_timeout_then_success(self):
        result=self.run_review([TimeoutError(),self.result()])
        self.assertEqual(len(result['fields']),1)
        self.assertEqual(len(self.calls),2)
    def test_truncated_then_complete_with_larger_budget(self):
        self.run_review([self.result(reason='length'),self.result()])
        self.assertEqual(self.calls[1][0]['max_tokens'],11000)
    def test_invalid_json_then_fenced_json(self):
        raw='```json\n'+self.result()['choices'][0]['message']['content']+'\n```'
        self.run_review([self.result('broken'),self.result(raw)])
    def test_fail_closed_after_two_attempts(self):
        with self.assertRaises(ReviewFailure) as err:self.run_review([self.result('broken'),self.result('broken')])
        self.assertEqual(err.exception.code,'invalid_json')
    def test_auth_not_retried(self):
        with self.assertRaises(ReviewFailure) as err:self.run_review([HTTPError('https://example.invalid',401,'auth',{},None)])
        self.assertEqual(err.exception.code,'provider_auth')
        self.assertEqual(len(self.calls),1)

if __name__=='__main__':unittest.main()
