from sqlmodel import Session, select
from app.db.engine import engine as db_engine
from app.models.engine import Engine
import pathlib

def check_paths():
    with Session(db_engine) as session:
        engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
        if not engine:
            print("No active engine found.")
            return

        print(f"Engine ID: {engine.id}")
        print(f"Engine Name: {engine.name}")
        print(f"Input Dir: {engine.input_dir}")
        
        if engine.input_dir:
            input_path = pathlib.Path(engine.input_dir)
            print(f"Input Path (Resolved): {input_path.resolve()}")
            
            if input_path.name == "input":
                custom_nodes_path = input_path.parent / "custom_nodes"
                print(f"Calculated Custom Nodes Path: {custom_nodes_path}")
                print(f"Exists: {custom_nodes_path.exists()}")
                
                # Check for masq folder
                masq_path = custom_nodes_path / "masquerade-nodes-comfyui"
                print(f"Masq Path: {masq_path}")
                print(f"Masq Exists: {masq_path.exists()}")
                if masq_path.exists():
                     print("Contents:")
                     for f in masq_path.iterdir():
                         print(f" - {f.name}")
            else:
                print("Input dir does not end with 'input', fallback logic might contain logic error.")

if __name__ == "__main__":
    check_paths()
