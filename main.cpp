#include <iostream>
#include <unordered_map>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <stdexcept>

// ============================================================================
// DATA STRUCTURE 1: CONCEPT (Node Structure)
// ============================================================================

class Concept {
public:
    std::string name;
    std::string id;
    std::string category;
    double initial_weight;
    double memory_strength;
    int last_revised_day;
    std::vector<std::string> prerequisites;

    Concept(const std::string& name, const std::string& id, 
            const std::string& category, double initial_weight,
            int last_revised_day, const std::vector<std::string>& prereqs)
        : name(name), id(id), category(category), 
          initial_weight(initial_weight), last_revised_day(last_revised_day),
          prerequisites(prereqs), memory_strength(initial_weight) {}

    double calculateMemory(int current_day, double lambda) const {
        int days_since_revision = current_day - last_revised_day;
        double decay = initial_weight * std::exp(-lambda * days_since_revision);
        return (decay < 0.1) ? 0.1 : (decay > 1.0) ? 1.0 : decay;
    }

    void updateMemoryStrength(int current_day, double lambda) {
        memory_strength = calculateMemory(current_day, lambda);
    }

    void revise(int current_day, double boost = 0.4) {
        memory_strength = std::min(1.0, memory_strength + boost);
        initial_weight = memory_strength;
        last_revised_day = current_day;
    }

    std::string toJSON() const {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2);
        oss << "{\"name\":\"" << name << "\",";
        oss << "\"id\":\"" << id << "\",";
        oss << "\"category\":\"" << category << "\",";
        oss << "\"initial_weight\":" << initial_weight << ",";
        oss << "\"memory_strength\":" << memory_strength << ",";
        oss << "\"last_revised_day\":" << last_revised_day << ",";
        oss << "\"prerequisites\":[";
        for (size_t i = 0; i < prerequisites.size(); i++) {
            oss << "\"" << prerequisites[i] << "\"";
            if (i < prerequisites.size() - 1) oss << ",";
        }
        oss << "]}";
        return oss.str();
    }
};

// ============================================================================
// DATA STRUCTURE 2: MINHEAP (Priority Queue)
// ============================================================================

struct HeapNode {
    std::string concept_id;
    double memory_strength;
    HeapNode(const std::string& id, double strength)
        : concept_id(id), memory_strength(strength) {}
};

class MinHeap {
private:
    std::vector<HeapNode> heap;

    void heapifyUp(int index) {
        while (index > 0 && heap[(index - 1) / 2].memory_strength > heap[index].memory_strength) {
            std::swap(heap[(index - 1) / 2], heap[index]);
            index = (index - 1) / 2;
        }
    }

    void heapifyDown(int index) {
        int minIndex = index;
        int left = 2 * index + 1;
        int right = 2 * index + 2;

        if (left < heap.size() && heap[left].memory_strength < heap[minIndex].memory_strength)
            minIndex = left;
        if (right < heap.size() && heap[right].memory_strength < heap[minIndex].memory_strength)
            minIndex = right;

        if (minIndex != index) {
            std::swap(heap[index], heap[minIndex]);
            heapifyDown(minIndex);
        }
    }

public:
    void insert(const std::string& concept_id, double memory_strength) {
        heap.push_back(HeapNode(concept_id, memory_strength));
        heapifyUp(heap.size() - 1);
    }

    std::string extractMin() {
        if (heap.empty()) throw std::runtime_error("Heap is empty");
        std::string min_id = heap[0].concept_id;
        heap[0] = heap.back();
        heap.pop_back();
        if (!heap.empty()) heapifyDown(0);
        return min_id;
    }

    std::string peekMin() const {
        if (heap.empty()) throw std::runtime_error("Heap is empty");
        return heap[0].concept_id;
    }

    bool isEmpty() const { return heap.empty(); }

    int size() const { return heap.size(); }

    void updateKey(const std::string& concept_id, double new_strength) {
        for (int i = 0; i < heap.size(); i++) {
            if (heap[i].concept_id == concept_id) {
                double old_strength = heap[i].memory_strength;
                heap[i].memory_strength = new_strength;
                if (new_strength < old_strength) {
                    heapifyUp(i);
                } else {
                    heapifyDown(i);
                }
                return;
            }
        }
    }

    void rebuild(const std::vector<std::pair<std::string, double>>& data) {
        heap.clear();
        for (const auto& item : data) {
            heap.push_back(HeapNode(item.first, item.second));
        }
        for (int i = heap.size() / 2 - 1; i >= 0; i--) {
            heapifyDown(i);
        }
    }

    void clear() { heap.clear(); }
};

// ============================================================================
// DATA STRUCTURE 3: MEMORY GRAPH (Graph + HashMap + All Algorithms)
// ============================================================================

class MemoryGraph {
private:
    std::unordered_map<std::string, Concept*> concepts;
    std::unordered_map<std::string, std::vector<std::string>> graph;
    MinHeap priority_queue;
    int current_day;
    double lambda;
    int total_revisions;

    void rebuildPriorityQueue() {
        std::vector<std::pair<std::string, double>> data;
        for (const auto& pair : concepts) {
            data.push_back({pair.first, pair.second->memory_strength});
        }
        priority_queue.rebuild(data);
    }

public:
    MemoryGraph(double decay_rate = 0.15) 
        : current_day(0), lambda(decay_rate), total_revisions(0) {}

    ~MemoryGraph() {
        for (auto& pair : concepts) {
            delete pair.second;
        }
    }

    // ALGORITHM 1: Insert Concept (Learn New Topic)
    // Complexity: O(log n)
    void insertConcept(const std::string& name, const std::string& id,
                      const std::string& category, double initial_weight,
                      const std::vector<std::string>& prerequisites) {
        Concept* new_concept = new Concept(name, id, category, initial_weight, 
                                          current_day, prerequisites);
        concepts[id] = new_concept;
        graph[id] = prerequisites;
        priority_queue.insert(id, initial_weight);
    }

    // ALGORITHM 2: Update Memory Strength (Decay Simulation)
    // Complexity: O(n log n)
    void updateMemoryStrengths() {
        for (auto& pair : concepts) {
            pair.second->updateMemoryStrength(current_day, lambda);
        }
        rebuildPriorityQueue();
    }

    // ALGORITHM 3: Get Next Revision Recommendation
    // Complexity: O(1) for retrieval
    std::string getNextRevisionRecommendation() {
        if (priority_queue.isEmpty()) return "";
        return priority_queue.peekMin();
    }

    // Get top recommendations (sorted by memory strength)
    std::vector<std::string> getTopRevisionRecommendations(int count) {
        std::vector<std::string> recommendations;
        std::vector<std::pair<std::string, double>> sorted_concepts;

        for (const auto& pair : concepts) {
            sorted_concepts.push_back({pair.first, pair.second->memory_strength});
        }

        std::sort(sorted_concepts.begin(), sorted_concepts.end(),
                  [](const auto& a, const auto& b) { return a.second < b.second; });

        int limit = std::min(count, (int)sorted_concepts.size());
        for (int i = 0; i < limit; i++) {
            recommendations.push_back(sorted_concepts[i].first);
        }
        return recommendations;
    }

    // ALGORITHM 4: Revise Topic (Boost Memory)
    // Complexity: O(log n + d) where d = degree
    void reviseConcept(const std::string& concept_id, double boost = 0.4) {
        auto it = concepts.find(concept_id);
        if (it == concepts.end()) {
            throw std::runtime_error("Concept not found: " + concept_id);
        }

        Concept* concept = it->second;
        concept->revise(current_day, boost);
        priority_queue.updateKey(concept_id, concept->memory_strength);

        // Boost connected concepts
        for (auto& pair : concepts) {
            Concept* other = pair.second;
            bool is_connected = false;

            for (const auto& prereq : other->prerequisites) {
                if (prereq == concept_id) {
                    is_connected = true;
                    break;
                }
            }

            if (!is_connected) {
                for (const auto& prereq : concept->prerequisites) {
                    if (prereq == other->id) {
                        is_connected = true;
                        break;
                    }
                }
            }

            if (is_connected) {
                other->memory_strength = std::min(1.0, other->memory_strength + 0.1);
                other->initial_weight = other->memory_strength;
                priority_queue.updateKey(other->id, other->memory_strength);
            }
        }
        total_revisions++;
    }

    void simulateTimePassage(int days) {
        current_day += days;
        updateMemoryStrengths();
    }

    void setDecayRate(double rate) { lambda = rate; }

    int getCurrentDay() const { return current_day; }
    int getTotalRevisions() const { return total_revisions; }
    int getTotalConcepts() const { return concepts.size(); }

    double getAverageMemoryStrength() const {
        if (concepts.empty()) return 0.0;
        double sum = 0.0;
        for (const auto& pair : concepts) {
            sum += pair.second->memory_strength;
        }
        return sum / concepts.size();
    }

    int getUrgentCount() const {
        int count = 0;
        for (const auto& pair : concepts) {
            if (pair.second->memory_strength < 0.3) count++;
        }
        return count;
    }

    std::vector<Concept*> getAllConcepts() const {
        std::vector<Concept*> result;
        for (const auto& pair : concepts) {
            result.push_back(pair.second);
        }
        return result;
    }

    Concept* getConcept(const std::string& id) const {
        auto it = concepts.find(id);
        return (it == concepts.end()) ? nullptr : it->second;
    }

    std::string toJSON() const {
        std::ostringstream oss;
        oss << "[";
        bool first = true;
        for (const auto& pair : concepts) {
            if (!first) oss << ",";
            oss << pair.second->toJSON();
            first = false;
        }
        oss << "]";
        return oss.str();
    }

    std::string getStatsJSON() const {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2);
        oss << "{";
        oss << "\"totalConcepts\":" << getTotalConcepts() << ",";
        oss << "\"avgMemory\":" << (getAverageMemoryStrength() * 100) << ",";
        oss << "\"urgentCount\":" << getUrgentCount() << ",";
        oss << "\"totalRevisions\":" << total_revisions << ",";
        oss << "\"currentDay\":" << current_day;
        oss << "}";
        return oss.str();
    }

    std::string getRevisionQueueJSON(int count = 10) const {
        std::ostringstream oss;
        oss << "[";
        auto recommendations = const_cast<MemoryGraph*>(this)->getTopRevisionRecommendations(count);
        for (size_t i = 0; i < recommendations.size(); i++) {
            Concept* concept = getConcept(recommendations[i]);
            if (concept) {
                oss << concept->toJSON();
                if (i < recommendations.size() - 1) oss << ",";
            }
        }
        oss << "]";
        return oss.str();
    }
};

// ============================================================================
// MAIN PROGRAM
// ============================================================================

MemoryGraph* memoryGraph = nullptr;

void initializeSampleData() {
    memoryGraph = new MemoryGraph(0.15);

    memoryGraph->insertConcept("Binary Search", "binary_search", "Algorithms", 0.85, {"arrays"});
    memoryGraph->insertConcept("Arrays", "arrays", "Data Structures", 0.45, {});
    memoryGraph->insertConcept("Sorting Algorithms", "sorting", "Algorithms", 0.62, {"arrays"});
    memoryGraph->insertConcept("Linked Lists", "linked_lists", "Data Structures", 0.28, {});
    memoryGraph->insertConcept("Binary Trees", "trees", "Data Structures", 0.75, {"linked_lists"});
    memoryGraph->insertConcept("Hash Tables", "hash_tables", "Data Structures", 0.55, {"arrays"});
    memoryGraph->insertConcept("Graph Traversal", "graphs", "Algorithms", 0.35, {"trees"});
    memoryGraph->insertConcept("Dynamic Programming", "dp", "Algorithms", 0.90, {"sorting"});
}

void processCommand(const std::string& command, const std::string& data) {
    try {
        if (command == "GET_ALL_CONCEPTS") {
            std::cout << memoryGraph->toJSON() << std::endl;
        }
        else if (command == "GET_STATS") {
            std::cout << memoryGraph->getStatsJSON() << std::endl;
        }
        else if (command == "GET_REVISION_QUEUE") {
            std::cout << memoryGraph->getRevisionQueueJSON(10) << std::endl;
        }
        else if (command == "REVISE_CONCEPT") {
            memoryGraph->reviseConcept(data);
            std::cout << "{\"status\":\"success\",\"message\":\"Concept revised\"}" << std::endl;
        }
        else if (command == "SIMULATE_TIME") {
            int days = std::stoi(data);
            memoryGraph->simulateTimePassage(days);
            std::cout << "{\"status\":\"success\",\"days\":" << days << "}" << std::endl;
        }
        else if (command == "ADD_CONCEPT") {
            std::istringstream iss(data);
            std::string name, id, category, prereqs_str;
            std::getline(iss, name, '|');
            std::getline(iss, id, '|');
            std::getline(iss, category, '|');
            std::getline(iss, prereqs_str, '|');

            std::vector<std::string> prerequisites;
            if (!prereqs_str.empty()) {
                std::istringstream prereq_stream(prereqs_str);
                std::string prereq;
                while (std::getline(prereq_stream, prereq, ',')) {
                    prerequisites.push_back(prereq);
                }
            }

            memoryGraph->insertConcept(name, id, category, 1.0, prerequisites);
            std::cout << "{\"status\":\"success\",\"message\":\"Concept added\"}" << std::endl;
        }
        else if (command == "SET_DECAY_RATE") {
            double rate = std::stod(data);
            memoryGraph->setDecayRate(rate);
            memoryGraph->updateMemoryStrengths();
            std::cout << "{\"status\":\"success\",\"rate\":" << rate << "}" << std::endl;
        }
        else {
            std::cout << "{\"status\":\"error\",\"message\":\"Unknown command\"}" << std::endl;
        }
    }
    catch (const std::exception& e) {
        std::cout << "{\"status\":\"error\",\"message\":\"" << e.what() << "\"}" << std::endl;
    }
}

int main(int argc, char* argv[]) {
    initializeSampleData();

    if (argc > 1) {
        std::string command = argv[1];
        std::string data = (argc > 2) ? argv[2] : "";
        processCommand(command, data);
    }
    else {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line.empty() || line == "EXIT") break;
            size_t pos = line.find(' ');
            std::string command = line.substr(0, pos);
            std::string data = (pos != std::string::npos) ? line.substr(pos + 1) : "";
            processCommand(command, data);
            std::cout.flush();
        }
    }

    delete memoryGraph;
    return 0;
}
