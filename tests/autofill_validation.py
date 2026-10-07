import unittest
import json
from pathlib import Path
from api.autofill_validation import validate_mapping

class MappingValidationTests(unittest.TestCase):
    def mapping(self,value='أحمد'):
        return {'fields':[{'label':'الاسم','anchor':'الاسم','value':value,'source_hint':value,'confidence':.99}], 'coverage':{'complete':True,'target_fields_checked':1,'source_facts_checked':1,'missed_relevant_facts':[]}}
    def test_long_value_preserved(self):
        value='بيانات طويلة ' * 220
        fields,_=validate_mapping(self.mapping(value),value,'الاسم:')
        self.assertEqual(fields[0]['value'],value.strip())
        self.assertGreater(len(fields[0]['value']),1600)
    def test_duplicate_destination_rejected(self):
        d=self.mapping();d['fields'].append(dict(d['fields'][0]))
        with self.assertRaisesRegex(ValueError,'تكرر'):validate_mapping(d,'أحمد','الاسم:')
    def test_false_complete_rejected(self):
        for flag in ['false','true',False,None]:
            d=self.mapping();d['coverage']['complete']=flag
            with self.assertRaises(ValueError):validate_mapping(d,'أحمد','الاسم:')
    def test_source_quote_and_target_required(self):
        with self.assertRaisesRegex(ValueError,'المصدر'):validate_mapping(self.mapping(),'محمد','الاسم:')
        with self.assertRaisesRegex(ValueError,'النموذج'):validate_mapping(self.mapping(),'أحمد','الهاتف:')
    def test_no_silent_field_limit(self):
        d=self.mapping();d['fields']*=161
        with self.assertRaisesRegex(ValueError,'١٦٠'):validate_mapping(d,'أحمد','الاسم:')
    def test_scattered_uploaded_pair_all_22_fields(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/scattered-transfer.json').read_text())
        payload={'fields':fixture['fields'],'coverage':{'complete':True,'target_fields_checked':22,'source_facts_checked':22,'missed_relevant_facts':[]}}
        fields,_=validate_mapping(payload,fixture['source'],fixture['target'])
        self.assertEqual(len(fields),22)
        for actual, expected in zip(fields,fixture['fields']):
            self.assertEqual(actual['value'],expected['value'])
            self.assertIn(actual['source_hint'],fixture['source'])
            self.assertIn(actual['value'],actual['source_hint'])
    def test_numeric_substrings_not_evidence(self):
        for source in ['رقم 12345','12 34']:
            with self.assertRaises(ValueError):validate_mapping(self.mapping('1234'),source,'الاسم')
    def test_digits_normalized_and_hint_repaired(self):
        d=self.mapping('1234');d['fields'][0]['source_hint']='الرقم النهائي 1234'
        fields,_=validate_mapping(d,'الرقم: ١٢٣٤','الاسم')
        self.assertEqual(fields[0]['source_hint'],'الرقم: ١٢٣٤')
    def test_blank_is_preserved(self):
        fields,_=validate_mapping(self.mapping(''),'أحمد','الاسم:')
        self.assertEqual(len(fields),1);self.assertEqual(fields[0]['value'],'')

if __name__=='__main__':unittest.main()
