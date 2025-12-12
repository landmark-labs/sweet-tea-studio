
from app.models.job import Job, JobCreate
from sqlmodel import SQLModel

# Mock validation of the model transfer
def test_job_creation():
    job_data = JobCreate(
        engine_id=1,
        workflow_template_id=1,
        input_params={},
        output_dir="my_custom_folder"
    )
    
    print(f"JobCreate output_dir: {job_data.output_dir}")
    
    # Simulate the API endpoint logic
    job = Job.from_orm(job_data)
    
    print(f"Job output_dir: {job.output_dir}")
    
    if job.output_dir == "my_custom_folder":
        print("SUCCESS: output_dir copied correctly")
    else:
        print("FAILURE: output_dir lost")

if __name__ == "__main__":
    test_job_creation()
