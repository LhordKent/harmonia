"""Run real migration SQL against captured V4 schema; compare with generated Room V6."""
import json
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = sqlite3.connect(':memory:')
old.executescript((root / 'app/src/test/resources/migrations/v4.sql').read_text())
tables = [row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")]
before = {}
for table in tables:
    info = list(old.execute(f'PRAGMA table_info("{table}")'))
    values = [f'saved_{column[1]}' if column[2] == 'TEXT' else 42 for column in info]
    old.execute(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in values)})', values)
    before[table] = dict(zip([c[1] for c in info], values))
source = (root / 'app/src/main/java/com/harmonia/app/data/local/HarmoniaDatabase.kt').read_text(encoding='utf-8')
migration = source.split('val MIGRATION_4_5 =', 1)[1].split('fun getInstance', 1)[0] + source.split('val MIGRATION_5_6 =', 1)[1].split('val MIGRATION_4_5 =', 1)[0]
for sql in re.findall(r'db.execSQL\("([^"\n]+)"\)', migration):
    old.execute(sql)
generated = (root / 'app/build/generated/source/kapt/debug/com/harmonia/app/data/local/HarmoniaDatabase_Impl.java').read_text()
assert 'RoomOpenDelegate(6,' in generated, 'Build the version 6 app first'
fresh = sqlite3.connect(':memory:')
for sql in re.findall(r'SQLite.execSQL\(connection, "((?:[^"\\]|\\.)*)"\)', generated):
    sql = json.loads('"' + sql + '"')
    if sql.startswith('CREATE') and 'room_master_table' not in sql:
        fresh.execute(sql)
for table in tables + ['coach_assessments']:
    # Column ordering is immaterial to Room's schema validation.
    schema = lambda db: sorted(tuple(c[1:]) for c in db.execute(f'PRAGMA table_info("{table}")'))
    assert schema(old) == schema(fresh), f'Room schema mismatch: {table}'
    if table in before:
        columns = [c[1] for c in old.execute(f'PRAGMA table_info("{table}")')]
        row = dict(zip(columns, old.execute(f'SELECT * FROM "{table}"').fetchone()))
        assert all(row[key] == value for key, value in before[table].items()), f'Data loss: {table}'
old.execute("UPDATE analysis_results SET coachVerdict='Good stability', coachFeedback='Steady breath', coachPitchScore=82, coachToneScore=78, reviewedBy='coach1', reviewedAt=1700000000000")
row = old.execute('SELECT accuracyScore, coachPitchScore, coachFeedback FROM analysis_results').fetchone()
assert row == (42, 82, 'Steady breath'), row
print(f'PASS: V4-to-V6 migration matches generated Room schema; saved rows survive in all {len(tables)} existing tables; original scores survive coach review.')
