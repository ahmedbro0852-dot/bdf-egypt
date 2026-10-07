import unittest
from api.ai_documents import chunks, process_document, text_result
from api.ai_review import ReviewFailure

class DocumentTests(unittest.TestCase):
    def test_chunks_preserve_every_character(self):
        text=('اسم: أحمد\nرقم ١٥، سعر 4,800 جنيه.\n'*1000)+'نهاية'
        parts=chunks(text)
        self.assertEqual(''.join(parts),text)
        self.assertTrue(all(len(p)<=10000 for p in parts))
    def test_translation_order_and_all_parts(self):
        text='a'*25000
        def runner(base,key,payload,**kwargs):return payload['messages'][-1]['content']
        out=process_document('translate',text,'Arabic','https://example.invalid','test','test',runner)
        self.assertEqual(out['processing']['parts'],3)
        self.assertEqual(out['text'].replace('\n\n',''),text)
    def test_summary_merge_contains_each_part(self):
        calls=[]
        def runner(base,key,payload,**kwargs):
            calls.append(payload)
            return 'ملخص جزء' if len(calls)<4 else 'ملخص شامل'
        out=process_document('summarize','a'*25000,'Arabic','https://example.invalid','test','test',runner)
        self.assertEqual(len(calls),4)
        self.assertIn('الجزء 3',calls[-1]['messages'][-1]['content'])
        self.assertEqual(out['text'],'ملخص شامل')
    def test_partial_results_not_returned(self):
        def runner(*args,**kwargs):raise ReviewFailure('provider_timeout')
        with self.assertRaises(ReviewFailure):process_document('translate','a'*25000,'Arabic','https://example.invalid','test','test',runner)
    def test_blank_and_truncated_rejected(self):
        for content,reason in [('', 'stop'),('partial','length')]:
            with self.assertRaises(ReviewFailure):text_result({'choices':[{'finish_reason':reason,'message':{'content':content}}]})

if __name__=='__main__':unittest.main()
