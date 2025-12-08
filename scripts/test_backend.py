import httpx
import time
import sys

API_URL = "http://127.0.0.1:8000/api/v1"

def test_backend():
    print("1. Creating Engine...")
    engine_data = {
        "name": "Local Comfy",
        "base_url": "http://127.0.0.1:8188",
        "output_dir": "C:/ComfyUI/output" # Dummy path for now
    }
    try:
        res = httpx.post(f"{API_URL}/engines/", json=engine_data)
        res.raise_for_status()
        engine = res.json()
        print(f"   Engine created: ID={engine['id']}")
    except Exception as e:
        print(f"   Failed to create engine: {e}")
        return

    print("\n2. Submitting Job...")
    job_data = {
        "engine_id": engine['id'],
        "workflow_template_id": 1,
        "input_params": {} # No params mapped yet
    }
    try:
        res = httpx.post(f"{API_URL}/jobs/", json=job_data)
        res.raise_for_status()
        job = res.json()
        print(f"   Job created: ID={job['id']} Status={job['status']}")
    except Exception as e:
        print(f"   Failed to create job: {e}")
        print(res.text)
        return

    print("\n3. Polling for completion...")
    while True:
        res = httpx.get(f"{API_URL}/jobs/{job['id']}")
        if res.status_code == 404:
            print("DEBUG: Job not found. Listing all jobs:")
            all_jobs = httpx.get(f"{API_URL}/jobs/").json()
            print(all_jobs)
            
        print(f"DEBUG: Response: {res.text}")
        job = res.json()
        print(f"   Status: {job.get('status')}")
        
        if job['status'] in ['completed', 'failed']:
            break
        
        time.sleep(1)

    if job['status'] == 'completed':
        print("\nSUCCESS: Job completed successfully!")
    else:
        print(f"\nFAILURE: Job failed. Full details: {job}")

if __name__ == "__main__":
    # Wait a bit for server to start if running immediately after
    time.sleep(2) 
    test_backend()
