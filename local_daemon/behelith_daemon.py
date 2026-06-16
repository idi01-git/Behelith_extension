import sys
import struct
import json
import subprocess
import tempfile
import os
import time

# Helper to read a message from Chrome Native Messaging
def read_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        message_length = struct.unpack('@I', raw_length)[0]
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        return json.loads(message)
    except Exception as e:
        return None

# Helper to send a message to Chrome Native Messaging
def send_message(message):
    try:
        content = json.dumps(message).encode('utf-8')
        length = struct.pack('@I', len(content))
        sys.stdout.buffer.write(length)
        sys.stdout.buffer.write(content)
        sys.stdout.buffer.flush()
    except Exception as e:
        pass

def handle_run_request(payload):
    code = payload.get('code', '')
    language = payload.get('language', 'cpp')
    inputs = payload.get('inputs', [])
    
    # Read user configuration settings for compiler
    cpp_version = payload.get('cpp_version', 'c++17')
    cpp_opt = payload.get('cpp_opt', '-O0') # Default changed to -O0 for speed
    
    with tempfile.TemporaryDirectory(prefix='behelith_') as work_dir:
        return run_in_temp_dir(payload, code, language, inputs, cpp_version, cpp_opt, work_dir)

def run_in_temp_dir(payload, code, language, inputs, cpp_version, cpp_opt, work_dir):
    if language == 'cpp':
        source_file = os.path.join(work_dir, 'solution.cpp')
        exe_file = os.path.join(work_dir, 'solution.exe')

        # Write C++ code to temporary file
        try:
            with open(source_file, 'w', encoding='utf-8') as f:
                f.write(code)
        except Exception as e:
            return {
                "status": "compile_error",
                "output": f"Error writing source file: {str(e)}"
            }
            
        # Compile code via g++ with dynamic flags
        std_flag = f'-std={cpp_version}'
        try:
            compile_process = subprocess.run(
                ['g++', cpp_opt, std_flag, source_file, '-o', exe_file],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=10.0,
                cwd=work_dir
            )
            if compile_process.returncode != 0:
                return {
                    "status": "compile_error",
                    "output": f"Compilation Error:\n{compile_process.stderr}"
                }
        except subprocess.TimeoutExpired:
            return {
                "status": "compile_error",
                "output": "Compilation timed out after 10.0 seconds."
            }
        except Exception as e:
            return {
                "status": "compile_error",
                "output": f"Failed to invoke compiler (g++). Is it installed and in your PATH?\nDetails: {str(e)}"
            }
            
        # Execute binary against each test input
        results = []
        for idx, test_input in enumerate(inputs):
            start_time = time.perf_counter()
            try:
                run_process = subprocess.run(
                    [exe_file],
                    input=test_input,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=2.0,  # Strict 2.0-second timeout constraint
                    cwd=work_dir
                )
                
                execution_time = (time.perf_counter() - start_time) * 1000
                
                if run_process.returncode != 0:
                    results.append({
                        "status": "runtime_error",
                        "stdout": run_process.stdout,
                        "stderr": run_process.stderr + f"\nProcess exited with code {run_process.returncode}",
                        "time_ms": round(execution_time)
                    })
                else:
                    results.append({
                        "status": "success",
                        "stdout": run_process.stdout,
                        "stderr": run_process.stderr,
                        "time_ms": round(execution_time)
                    })
                
            except subprocess.TimeoutExpired:
                execution_time = (time.perf_counter() - start_time) * 1000
                results.append({
                    "status": "timeout",
                    "stdout": "",
                    "stderr": "Result: TLE (Time Limit Exceeded - 2.0s)",
                    "time_ms": round(execution_time)
                })
            except Exception as e:
                execution_time = (time.perf_counter() - start_time) * 1000
                results.append({
                    "status": "runtime_error",
                    "stdout": "",
                    "stderr": f"Runtime Error: {str(e)}",
                    "time_ms": round(execution_time)
                })
                
        return {
            "status": "success",
            "compiler_info": f"Compiler: g++ {cpp_opt} -std={cpp_version}",
            "results": results
        }

    elif language == 'python':
        source_file = os.path.join(work_dir, 'solution.py')
        
        # Write Python code to temporary file
        try:
            with open(source_file, 'w', encoding='utf-8') as f:
                f.write(code)
        except Exception as e:
            return {
                "status": "compile_error",
                "output": f"Error writing source file: {str(e)}"
            }
            
        # Execute script against each test input
        results = []
        for idx, test_input in enumerate(inputs):
            start_time = time.perf_counter()
            try:
                run_process = subprocess.run(
                    ['python', '-u', source_file],
                    input=test_input,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=2.0,  # Strict 2.0-second timeout constraint
                    cwd=work_dir
                )
                
                execution_time = (time.perf_counter() - start_time) * 1000
                
                if run_process.returncode != 0:
                    results.append({
                        "status": "runtime_error",
                        "stdout": run_process.stdout,
                        "stderr": run_process.stderr + f"\nProcess exited with code {run_process.returncode}",
                        "time_ms": round(execution_time)
                    })
                else:
                    results.append({
                        "status": "success",
                        "stdout": run_process.stdout,
                        "stderr": run_process.stderr,
                        "time_ms": round(execution_time)
                    })
                
            except subprocess.TimeoutExpired:
                execution_time = (time.perf_counter() - start_time) * 1000
                results.append({
                    "status": "timeout",
                    "stdout": "",
                    "stderr": "Result: TLE (Time Limit Exceeded - 2.0s)",
                    "time_ms": round(execution_time)
                })
            except Exception as e:
                execution_time = (time.perf_counter() - start_time) * 1000
                results.append({
                    "status": "runtime_error",
                    "stdout": "",
                    "stderr": f"Runtime Error: {str(e)}",
                    "time_ms": round(execution_time)
                })
                
        return {
            "status": "success",
            "compiler_info": "Python 3",
            "results": results
        }
        
    else:
        return {
            "status": "compile_error",
            "output": f"Unsupported local run language: {language}"
        }

def main():
    while True:
        message = read_message()
        if message is None:
            break
        
        if message.get('type') == 'run':
            result = handle_run_request(message)
            send_message(result)

if __name__ == '__main__':
    main()
