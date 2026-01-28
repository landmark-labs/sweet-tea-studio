import sqlite3
import json

# Create in-memory DB
conn = sqlite3.connect(":memory:")
cursor = conn.cursor()

# Create table
cursor.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, data JSON)")

# Insert valid JSON
cursor.execute("INSERT INTO test (data) VALUES (?)", ('{"foo": "bar"}',))

# Insert invalid JSON (simulate the bug)
cursor.execute("INSERT INTO test (data) VALUES (?)", ('{"foo": "unterm',))

conn.commit()

print("Fetching with raw SQL...")
cursor.execute("SELECT id, data FROM test")
rows = cursor.fetchall()
for row in rows:
    print(f"ID: {row[0]}, Data Type: {type(row[1])}, Data: {row[1]}")
    try:
        json.loads(row[1])
        print("Optional: Parse OK")
    except json.JSONDecodeError as e:
        print(f"Optional: Parse Error: {e}")

conn.close()
