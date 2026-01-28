import sqlite3
import json
import os

db_path = os.path.expanduser("~/.sweet-tea/meta/profile.db")
print(f"Checking database at: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    table_name = "workflowtemplate"

    print(f"Inspecting table: {table_name}")
    cursor.execute(f"SELECT id, graph_json, input_schema, node_mapping FROM {table_name}")
    rows = cursor.fetchall()
    
    print(f"Found {len(rows)} rows.")
    
    for row in rows:
        row_id, graph_json, input_schema, node_mapping = row
        
        # Check graph_json
        try:
            if graph_json:
                json.loads(graph_json)
        except json.JSONDecodeError as e:
            print(f"ERROR in graph_json for ID {row_id}: {e}")
            print(f"Content length: {len(graph_json) if graph_json else 0}")
            
        # Check input_schema
        try:
            if input_schema:
                json.loads(input_schema)
        except json.JSONDecodeError as e:
            print(f"ERROR in input_schema for ID {row_id}: {e}")
            print(f"Content length: {len(input_schema) if input_schema else 0}")

        # Check node_mapping
        try:
            if node_mapping:
                json.loads(node_mapping)
        except json.JSONDecodeError as e:
            print(f"ERROR in node_mapping for ID {row_id}: {e}")
            print(f"Content length: {len(node_mapping) if node_mapping else 0}")
            print(f"Content (last 100 chars): {node_mapping[-100:] if node_mapping else 'None'}")

    conn.close()
    print("Finished inspection.")

except Exception as e:
    print(f"An error occurred: {e}")
