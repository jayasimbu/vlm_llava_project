import requests
import json
import os

API_URL = "http://127.0.0.1:8000"
TEST_IMAGE = "nhg.jpg"

def test_a_to_z():
    print("Starting A to Z Test...")
    
    if not os.path.exists(TEST_IMAGE):
        print(f"Test image {TEST_IMAGE} not found in root.")
        return

    # 1. Test Server Health
    print("\n1. Testing Server Health...")
    try:
        r = requests.get(f"{API_URL}/")
        if r.status_code == 200:
            print("Server is UP and serving Frontend.")
        else:
            print(f"Server returned {r.status_code}")
    except Exception as e:
        print(f"Failed to connect to server: {e}")
        return

    # 2. Test English Extraction
    print("\n2. Testing English Extraction...")
    try:
        with open(TEST_IMAGE, "rb") as f:
            files = {"file": ("nhg.jpg", f, "image/jpeg")}
            data = {"lang": "en"}
            r_extract = requests.post(f"{API_URL}/extract", files=files, data=data)
            
        if r_extract.status_code == 200:
            result = r_extract.json()
            print("Extraction Successful!")
            print(json.dumps(result['data'], indent=2))
            invoice_data = result['data']
        else:
            print(f"Extraction failed with status {r_extract.status_code}: {r_extract.text}")
            return
    except Exception as e:
        print(f"Extraction error: {e}")
        return

    # 3. Test Q&A Endpoint
    print("\n3. Testing Q&A (Ask AI)...")
    try:
        ask_payload = {
            "question": "What is the total amount?",
            "invoice_data": invoice_data
        }
        r_ask = requests.post(f"{API_URL}/ask", json=ask_payload)
        if r_ask.status_code == 200:
            print(f"Q&A Successful! Answer: {r_ask.json()['answer']}")
        else:
            print(f"Q&A failed with status {r_ask.status_code}: {r_ask.text}")
    except Exception as e:
        print(f"Q&A error: {e}")

    print("\nAll Backend A-to-Z tests completed successfully!")

if __name__ == "__main__":
    test_a_to_z()
