import os
import sys

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.vlm import load_vlm_from_env

def download():
    print("Initializing VLM Service configuration...")
    service = load_vlm_from_env()
    print(f"Target Model: {service.config.model_id}")
    print("Starting download (this may take a while for large models)...")
    
    # This triggers the ensuring logic which calls from_pretrained
    # We force enabled=True to ensure it tries to load
    service.config.enabled = True
    service.ensure_loaded()
    
    if service._model:
        print("✅ Model successfully downloaded and loaded!")
    else:
        print("❌ Model download/load failed. Check logs.")
        print(service.status())

if __name__ == "__main__":
    download()
