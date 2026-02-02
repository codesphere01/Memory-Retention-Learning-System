#!/usr/bin/env python3
"""
Simple Python Flask API - Connects C++ Backend with Frontend
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import subprocess
import json
import sys
import math

app = Flask(__name__)
CORS(app)

# Handle Windows vs Unix executable extension
if sys.platform == "win32":
    CPP_EXECUTABLE = "./memory_graph_app.exe"
else:
    CPP_EXECUTABLE = "./memory_graph_app"

# In-memory state to persist between requests
app_state = {
    "concepts": [],
    "stats": {},
    "initialized": False
}

def calculate_days_since_revision(memory_strength, initial_weight, lambda_rate):
    """Calculate days since last revision based on memory strength and decay rate"""
    if initial_weight <= 0:
        return 0  # Invalid initial weight
    
    # If memory equals or exceeds initial, assume it was recently revised
    # But if memory is very low, assume it started higher and decayed
    if memory_strength >= initial_weight:
        # If memory is high (>= 0.9), it was just revised (0 days)
        if memory_strength >= 0.9:
            return 0
        # Otherwise, assume it started at 1.0 and decayed slightly
        initial_weight = 1.0
    
    # Formula: memory = initial * exp(-lambda * days)
    # Solving for days: days = -ln(memory/initial) / lambda
    ratio = memory_strength / initial_weight
    if ratio <= 0:
        return 999  # Very old (memory decayed to near zero)
    
    try:
        days = -math.log(ratio) / lambda_rate
        return max(0, int(round(days)))
    except (ValueError, ZeroDivisionError):
        return 0

def initialize_state():
    """Initialize state from C++ backend"""
    if not app_state["initialized"]:
        result = run_cpp_command("GET_ALL_CONCEPTS")
        if isinstance(result, list):
            app_state["concepts"] = result
            # Calculate realistic last_revised_day based on current memory strength
            lambda_rate = 0.15  # Default decay rate
            # Start at day 30 to give room for realistic day calculations
            current_day = 30
            
            for concept in app_state["concepts"]:
                memory = concept.get("memory_strength", 1.0)
                initial = concept.get("initial_weight", 1.0)  # Default to 1.0 if not set
                
                # If initial_weight is missing or equals memory, assume realistic initial based on memory
                if "initial_weight" not in concept or initial == memory:
                    # For low memory concepts, assume they started higher and decayed
                    if memory < 0.5:
                        initial = 0.85  # Assume started at 85%
                    elif memory < 0.7:
                        initial = 0.90  # Assume started at 90%
                    else:
                        initial = max(memory, 0.95)  # Assume started at 95% or current if higher
                    concept["initial_weight"] = initial
                
                # Calculate days since revision based on decay
                days_since = calculate_days_since_revision(memory, initial, lambda_rate)
                # Set last_revised_day so that current_day - last_revised_day = days_since
                concept["last_revised_day"] = current_day - days_since
                # Ensure last_revised_day is not negative
                concept["last_revised_day"] = max(0, concept["last_revised_day"])
            
            # Set initial current day
            app_state["stats"]["currentDay"] = current_day
        
        result = run_cpp_command("GET_STATS")
        if isinstance(result, dict) and "status" not in result:
            app_state["stats"].update(result)
            # Ensure currentDay is set
            if "currentDay" not in app_state["stats"]:
                app_state["stats"]["currentDay"] = 0
        
        app_state["initialized"] = True

def run_cpp_command(command, data=""):
    """Execute C++ backend command"""
    try:
        if data:
            result = subprocess.run([CPP_EXECUTABLE, command, data], capture_output=True, text=True, timeout=5)
        else:
            result = subprocess.run([CPP_EXECUTABLE, command], capture_output=True, text=True, timeout=5)

        if result.returncode != 0:
            return {"status": "error", "message": result.stderr or "C++ executable returned error"}

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as e:
            return {"status": "error", "message": f"Invalid JSON from C++ backend: {e}. Output: {result.stdout[:100]}"}
    except FileNotFoundError:
        return {"status": "error", "message": f"C++ executable not found: {CPP_EXECUTABLE}. Please compile main.cpp first."}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "C++ backend timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def find_concept_by_id(concept_id):
    """Find a concept in the state by ID"""
    for concept in app_state["concepts"]:
        if concept.get("id") == concept_id:
            return concept
    return None

def update_concept_in_state(concept_id, updates):
    """Update a concept in the state"""
    for i, concept in enumerate(app_state["concepts"]):
        if concept.get("id") == concept_id:
            app_state["concepts"][i].update(updates)
            return True
    return False

def add_concept_to_state(concept_data):
    """Add a new concept to the state"""
    app_state["concepts"].append(concept_data)
    # Update stats
    app_state["stats"]["totalConcepts"] = len(app_state["concepts"])
    # Recalculate average memory
    if app_state["concepts"]:
        total_memory = sum(c.get("memory_strength", 0) for c in app_state["concepts"])
        app_state["stats"]["avgMemory"] = (total_memory / len(app_state["concepts"])) * 100

@app.route('/api/concepts', methods=['GET'])
def get_all_concepts():
    initialize_state()
    return jsonify(app_state["concepts"])

@app.route('/api/stats', methods=['GET'])
def get_stats():
    initialize_state()
    # Recalculate stats from current state
    if app_state["concepts"]:
        total_memory = sum(c.get("memory_strength", 0) for c in app_state["concepts"])
        app_state["stats"]["totalConcepts"] = len(app_state["concepts"])
        app_state["stats"]["avgMemory"] = (total_memory / len(app_state["concepts"])) * 100
        app_state["stats"]["urgentCount"] = sum(1 for c in app_state["concepts"] if c.get("memory_strength", 0) < 0.3)
    return jsonify(app_state["stats"])

@app.route('/api/revision-queue', methods=['GET'])
def get_revision_queue():
    initialize_state()
    # Return all concepts sorted by memory strength (lowest first)
    queue = sorted(app_state["concepts"], key=lambda x: x.get("memory_strength", 0))
    return jsonify(queue)

@app.route('/api/revise/<concept_id>', methods=['POST'])
def revise_concept(concept_id):
    initialize_state()
    concept = find_concept_by_id(concept_id)
    if not concept:
        return jsonify({"status": "error", "message": "Concept not found"})
    
    # Update concept memory strength (boost by 0.4, cap at 1.0)
    current_memory = concept.get("memory_strength", 0)
    new_memory = min(1.0, current_memory + 0.4)
    
    update_concept_in_state(concept_id, {
        "memory_strength": new_memory,
        "initial_weight": new_memory,
        "last_revised_day": app_state["stats"].get("currentDay", 0)
    })
    
    # Update total revisions
    app_state["stats"]["totalRevisions"] = app_state["stats"].get("totalRevisions", 0) + 1
    
    return jsonify({"status": "success", "message": "Concept revised"})

@app.route('/api/simulate', methods=['POST'])
def simulate_time():
    initialize_state()
    data = request.get_json()
    days = data.get('days', 1)
    
    # Update current day
    app_state["stats"]["currentDay"] = app_state["stats"].get("currentDay", 0) + days
    
    # Apply memory decay to all concepts
    lambda_rate = 0.15  # Default decay rate
    current_day = app_state["stats"]["currentDay"]
    
    for concept in app_state["concepts"]:
        days_since_revision = current_day - concept.get("last_revised_day", 0)
        initial_weight = concept.get("initial_weight", 1.0)
        decay = initial_weight * math.exp(-lambda_rate * days_since_revision)  # e^(-lambda * days)
        concept["memory_strength"] = max(0.1, min(1.0, decay))
    
    return jsonify({"status": "success", "days": days})

@app.route('/api/concepts', methods=['POST'])
def add_concept():
    initialize_state()
    data = request.get_json()
    name = data.get('name', '')
    concept_id = data.get('id', '')
    category = data.get('category', '')
    prerequisites = data.get('prerequisites', [])
    
    # Check if concept already exists
    if find_concept_by_id(concept_id):
        return jsonify({"status": "error", "message": "Concept with this ID already exists"})
    
    # Create new concept (newly added, so last_revised_day = current_day)
    current_day = app_state["stats"].get("currentDay", 0)
    new_concept = {
        "name": name,
        "id": concept_id,
        "category": category,
        "initial_weight": 1.0,
        "memory_strength": 1.0,
        "last_revised_day": current_day,  # Just added, so revised today
        "prerequisites": prerequisites
    }
    
    add_concept_to_state(new_concept)
    return jsonify({"status": "success", "message": "Concept added"})

@app.route('/api/decay-rate', methods=['POST'])
def set_decay_rate():
    data = request.get_json()
    rate = data.get('rate', 0.15)
    result = run_cpp_command("SET_DECAY_RATE", str(rate))
    return jsonify(result)

# Serve static files (HTML, CSS, JS)
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    # Only serve specific static file types for security
    # Skip API routes
    if filename.startswith('api/'):
        return {"status": "error", "message": "API endpoint not found"}, 404
    if filename.endswith(('.css', '.js', '.html')):
        return send_from_directory('.', filename)
    return {"status": "error", "message": "File not found"}, 404

if __name__ == '__main__':
    print("Starting Memory-Retention Learning System API on http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
