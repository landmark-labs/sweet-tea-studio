import urllib.request
import json

SERVER_ADDRESS = "127.0.0.1:8188"

def get_checkpoints():
    url = f"http://{SERVER_ADDRESS}/object_info/CheckpointLoaderSimple"
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read())
            # The structure is data['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
            checkpoints = data['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
            return checkpoints
    except Exception as e:
        print(f"Error: {e}")
        return []

if __name__ == "__main__":
    print("Fetching checkpoints...")
    ckpts = get_checkpoints()
    print(f"Found {len(ckpts)} checkpoints:")
    for c in ckpts:
        print(f" - {c}")
