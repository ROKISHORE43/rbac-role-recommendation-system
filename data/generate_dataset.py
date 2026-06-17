"""
generate_dataset.py
--------------------
Generates a synthetic but structurally realistic enterprise identity and
RBAC role-assignment dataset for the AI-Based RBAC Role Recommendation
System.

The dataset simulates what would normally be sourced from SailPoint
Identity Security Cloud (ISC) via the /v3/identities, /v3/roles, and
/v3/identities/{id}/role-assignments API endpoints, after an enterprise
RBAC implementation has been completed and roles have been assigned
across divisions, departments, sections, and managers.

Output:
    data/identities.csv   - one row per Active identity, with org attributes
    data/roles.csv         - master list of RBAC roles per department
    data/assignments.csv   - identity -> role assignment matrix (long format)
    data/prehire_queue.csv - PreHire identities awaiting role recommendation
    data/transfer_queue.csv- Active identities undergoing a department transfer
"""

import csv
import random
import os

random.seed(42)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

DIVISIONS = {
    "Technology": ["IT", ],
    "Corporate Services": ["Finance"],
    "People & Culture": ["HR"],
}

DEPT_SECTIONS = {
    "IT": ["Infrastructure", "Cybersecurity", "Application Development", "Service Desk"],
    "Finance": ["Accounts Payable", "Budgeting & Planning", "Treasury", "Audit"],
    "HR": ["Talent Acquisition", "Learning & Development", "Compensation & Benefits", "HR Operations"],
}

SECTION_MANAGERS = {
    "Infrastructure": ("Deepa Rao", "IT Operations"),
    "Cybersecurity": ("Karthik Subramaniam", "IT Operations"),
    "Application Development": ("Farah Sheikh", "IT Operations"),
    "Service Desk": ("Imran Qureshi", "IT Operations"),

    "Accounts Payable": ("Suresh Kumar", "Finance"),
    "Budgeting & Planning": ("Lata Krishnamurthy", "Finance"),
    "Treasury": ("Naveen Pillai", "Finance"),
    "Audit": ("Geetha Raman", "Finance"),

    "Talent Acquisition": ("Ramesh Iyer", "HR"),
    "Learning & Development": ("Sunitha Joseph", "HR"),
    "Compensation & Benefits": ("Anil Bhatia", "HR"),
    "HR Operations": ("Kavya Menon", "HR"),
}

ROLES = {
    "IT": [
        ("R-IT-001", "IT Standard User", "Standard", True),
        ("R-IT-002", "Server Admin", "Privileged", False),
        ("R-IT-003", "Network Viewer", "Functional", False),
        ("R-IT-004", "ITSM Agent", "Operational", False),
        ("R-IT-005", "Cloud Operator", "Functional", False),
        ("R-IT-006", "Privileged Access Vault", "Privileged", False),
        ("R-IT-007", "Application Support Engineer", "Functional", False),
        ("R-IT-008", "Security Analyst", "Functional", False),
        ("R-IT-009", "Vulnerability Scanner", "Functional", False),
        ("R-IT-010", "Firewall Reviewer", "Functional", False),
        ("R-IT-011", "Incident Responder", "Privileged", False),
        ("R-IT-012", "Service Desk Agent", "Operational", False),
    ],
    "Finance": [
        ("R-FIN-001", "Finance Viewer", "Standard", True),
        ("R-FIN-002", "ERP Finance User", "System", False),
        ("R-FIN-003", "AP Processor", "Functional", False),
        ("R-FIN-004", "Budget Analyst", "Functional", False),
        ("R-FIN-005", "Expense Approver", "Approval", False),
        ("R-FIN-006", "Treasury Analyst", "Functional", False),
        ("R-FIN-007", "Internal Auditor", "Sensitive", False),
        ("R-FIN-008", "Payroll Viewer", "Sensitive", False),
    ],
    "HR": [
        ("R-HR-001", "HR Self-Service", "Standard", True),
        ("R-HR-002", "Recruiter", "Functional", False),
        ("R-HR-003", "HRIS Viewer", "Functional", False),
        ("R-HR-004", "Onboarding Coordinator", "Functional", False),
        ("R-HR-005", "Payroll Viewer", "Sensitive", False),
        ("R-HR-006", "Learning Platform Admin", "Functional", False),
        ("R-HR-007", "Compensation Analyst", "Sensitive", False),
    ],
}

FIRST_NAMES = ["Arjun","Priya","Sunita","Vikram","Meena","Ravi","Anjali","Deepak","Nisha",
               "Sanjeev","Geeta","Ajay","Kiran","Shalini","Rajesh","Preeti","Asha","Vijay",
               "Preethi","Kavitha","Srinivas","Divya","Venkat","Anand","Arun","Lakshmi",
               "Mohit","Pooja","Suresh","Rekha","Rohit","Sneha","Manoj","Pallavi","Naveen",
               "Swati","Ramesh","Latha","Karthik","Bhavna","Sandeep","Aarti","Vivek","Nandini",
               "Harish","Madhavi","Gopal","Indira","Tarun","Sapna","Yash"]

LAST_NAMES = ["Mehta","Nair","Patel","Rajan","Sharma","Krishnan","Bose","Varma","Thomas",
              "Pillai","Menon","Kulkarni","Rao","Das","Reddy","Subramaniam","Iyer","Kumar",
              "Joshi","Gupta","Babu","Iyer","Joseph","Chand","Singh","Verma","Pillai","Nayak",
              "Bhat","Acharya","Murthy","Chowdhury","Ghosh","Ranganathan","Krishnamurthy"]

TITLES_BY_SECTION = {
    "Infrastructure": ["Systems Analyst", "Infrastructure Engineer", "Senior Systems Analyst", "Platform Engineer"],
    "Cybersecurity": ["Security Analyst", "Threat Analyst", "SOC Analyst", "Security Engineer", "Pen Tester"],
    "Application Development": ["Software Engineer", "Senior Developer", "QA Engineer", "DevOps Engineer"],
    "Service Desk": ["Service Desk Analyst", "IT Support Specialist", "Desktop Support Engineer"],
    "Accounts Payable": ["Junior Accountant", "Senior Accountant", "AP Specialist", "AP Lead"],
    "Budgeting & Planning": ["Budget Analyst", "Finance Analyst", "FP&A Associate"],
    "Treasury": ["Treasury Analyst", "Treasury Associate", "Cash Manager"],
    "Audit": ["Internal Auditor", "Audit Associate", "Compliance Analyst"],
    "Talent Acquisition": ["HR Coordinator", "Recruiter", "Senior Recruiter", "Talent Specialist"],
    "Learning & Development": ["L&D Coordinator", "Training Specialist", "L&D Manager"],
    "Compensation & Benefits": ["Comp & Ben Analyst", "Benefits Specialist"],
    "HR Operations": ["HR Generalist", "HR Operations Analyst", "HRBP"],
}

# Per-section "typical" role adoption probabilities — drives realistic
# (not uniform-random) peer assignment patterns that the recommender
# engine can meaningfully learn from.
SECTION_ROLE_PROBABILITY = {
    "Infrastructure": {"R-IT-001": 1.00, "R-IT-002": 0.85, "R-IT-003": 0.75, "R-IT-004": 0.55,
                        "R-IT-005": 0.45, "R-IT-006": 0.30, "R-IT-007": 0.05, "R-IT-012": 0.10},
    "Cybersecurity": {"R-IT-001": 1.00, "R-IT-008": 0.95, "R-IT-009": 0.80, "R-IT-010": 0.70,
                       "R-IT-011": 0.55, "R-IT-006": 0.40, "R-IT-002": 0.05},
    "Application Development": {"R-IT-001": 1.00, "R-IT-007": 0.80, "R-IT-005": 0.65,
                                 "R-IT-004": 0.20, "R-IT-002": 0.05},
    "Service Desk": {"R-IT-001": 1.00, "R-IT-012": 0.95, "R-IT-004": 0.55, "R-IT-003": 0.10},

    "Accounts Payable": {"R-FIN-001": 1.00, "R-FIN-002": 0.90, "R-FIN-003": 0.85, "R-FIN-004": 0.10,
                          "R-FIN-005": 0.08},
    "Budgeting & Planning": {"R-FIN-001": 1.00, "R-FIN-002": 0.55, "R-FIN-004": 0.90, "R-FIN-005": 0.20},
    "Treasury": {"R-FIN-001": 1.00, "R-FIN-002": 0.60, "R-FIN-006": 0.90, "R-FIN-005": 0.10},
    "Audit": {"R-FIN-001": 1.00, "R-FIN-007": 0.90, "R-FIN-002": 0.15},

    "Talent Acquisition": {"R-HR-001": 1.00, "R-HR-002": 0.90, "R-HR-003": 0.40, "R-HR-004": 0.80},
    "Learning & Development": {"R-HR-001": 1.00, "R-HR-006": 0.85, "R-HR-003": 0.30, "R-HR-004": 0.15},
    "Compensation & Benefits": {"R-HR-001": 1.00, "R-HR-007": 0.90, "R-HR-005": 0.70, "R-HR-003": 0.25},
    "HR Operations": {"R-HR-001": 1.00, "R-HR-003": 0.80, "R-HR-004": 0.20, "R-HR-002": 0.08},
}


def make_identity_id(i, prefix="I"):
    return f"{prefix}-{2022 + (i % 4)}-{1000 + i:04d}"


def generate_active_identities(n_per_section=10):
    """Generate Active identities across all departments/sections with
    role assignments sampled from SECTION_ROLE_PROBABILITY."""
    identities = []
    assignments = []
    idx = 0
    for dept, sections in DEPT_SECTIONS.items():
        division = [d for d, depts in DIVISIONS.items() if dept in depts][0]
        for section in sections:
            for _ in range(n_per_section):
                idx += 1
                fn, ln = random.choice(FIRST_NAMES), random.choice(LAST_NAMES)
                name = f"{fn} {ln}"
                manager, manager_dept = SECTION_MANAGERS[section]
                title = random.choice(TITLES_BY_SECTION[section])
                ident_id = make_identity_id(idx)

                identities.append({
                    "identity_id": ident_id,
                    "name": name,
                    "division": division,
                    "department": dept,
                    "section": section,
                    "manager": manager,
                    "manager_department": manager_dept,
                    "title": title,
                    "lifecycle_state": "Active",
                })

                # sample role assignments according to section probability table
                probs = SECTION_ROLE_PROBABILITY.get(section, {})
                for role_id, p in probs.items():
                    if random.random() < p:
                        assignments.append({"identity_id": ident_id, "role_id": role_id})

    return identities, assignments


def generate_prehire_queue():
    """A handful of PreHire identities awaiting role recommendation."""
    prehires = [
        ("I-2025-9001", "Arjun Mehta", "Technology", "IT", "Infrastructure", "Deepa Rao", "IT Operations", "Systems Analyst", "2025-07-20"),
        ("I-2025-9002", "Priya Nair", "Corporate Services", "Finance", "Accounts Payable", "Suresh Kumar", "Finance", "Junior Accountant", "2025-07-15"),
        ("I-2025-9003", "Sunita Patel", "People & Culture", "HR", "Talent Acquisition", "Ramesh Iyer", "HR", "HR Coordinator", "2025-07-18"),
        ("I-2025-9004", "Vikram Rajan", "Technology", "IT", "Cybersecurity", "Karthik Subramaniam", "IT Operations", "Security Analyst", "2025-07-22"),
        ("I-2025-9005", "Lavanya Pillai", "Corporate Services", "Finance", "Treasury", "Naveen Pillai", "Finance", "Treasury Analyst", "2025-07-25"),
    ]
    rows = []
    for (iid, name, div, dept, section, mgr, mgr_dept, title, start) in prehires:
        rows.append({
            "identity_id": iid, "name": name, "division": div, "department": dept,
            "section": section, "manager": mgr, "manager_department": mgr_dept,
            "title": title, "lifecycle_state": "PreHire", "start_date": start,
        })
    return rows


def generate_transfer_queue():
    """Active identities mid-department-transfer, with old + new attributes."""
    transfers = [
        dict(identity_id="I-2024-9101", name="Meena Sharma",
             from_division="Corporate Services", from_department="Finance", from_section="Accounts Payable",
             from_manager="Suresh Kumar", from_manager_department="Finance",
             to_division="Technology", to_department="IT", to_section="Infrastructure",
             to_manager="Deepa Rao", to_manager_department="IT Operations",
             effective_date="2025-08-01", reason="Internal mobility - Technology division expansion"),
        dict(identity_id="I-2023-9102", name="Ravi Krishnan",
             from_division="Technology", from_department="IT", from_section="Infrastructure",
             from_manager="Deepa Rao", from_manager_department="IT Operations",
             to_division="People & Culture", to_department="HR", to_section="Talent Acquisition",
             to_manager="Ramesh Iyer", to_manager_department="HR",
             effective_date="2025-08-05", reason="Role redesign - HRBP embedded in Technology division"),
        dict(identity_id="I-2023-9103", name="Anjali Bose",
             from_division="People & Culture", from_department="HR", from_section="Talent Acquisition",
             from_manager="Ramesh Iyer", from_manager_department="HR",
             to_division="Corporate Services", to_department="Finance", to_section="Accounts Payable",
             to_manager="Suresh Kumar", to_manager_department="Finance",
             effective_date="2025-08-10", reason="Career progression - Finance rotation programme"),
    ]
    return transfers


def write_csv(path, rows, fieldnames):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    identities, assignments = generate_active_identities(n_per_section=15)
    prehire = generate_prehire_queue()
    transfers = generate_transfer_queue()

    # Seed each transferring identity into the Active identity table using
    # their OLD (from_*) attributes -- they are still Active in their
    # original department/section until the transfer takes effect -- and
    # assign them a realistic set of roles for that old section, sampled
    # the same way as the rest of the population. This makes the
    # "roles to revoke" list reflect genuine, explainable data rather
    # than being hardcoded.
    for t in transfers:
        identities.append({
            "identity_id": t["identity_id"],
            "name": t["name"],
            "division": t["from_division"],
            "department": t["from_department"],
            "section": t["from_section"],
            "manager": t["from_manager"],
            "manager_department": t["from_manager_department"],
            "title": "Transferring Employee",
            "lifecycle_state": "Active",
        })
        probs = SECTION_ROLE_PROBABILITY.get(t["from_section"], {})
        # ensure at least the birthright + one functional role for realism
        forced_roles = list(probs.items())
        random.shuffle(forced_roles)
        assigned_any = False
        for role_id, p in forced_roles:
            if random.random() < max(p, 0.6):  # bias toward assigning something visible
                assignments.append({"identity_id": t["identity_id"], "role_id": role_id})
                assigned_any = True
        if not assigned_any and forced_roles:
            # guarantee at least the birthright role
            assignments.append({"identity_id": t["identity_id"], "role_id": forced_roles[0][0]})

    # roles.csv
    role_rows = []
    for dept, role_list in ROLES.items():
        for role_id, name, category, birthright in role_list:
            role_rows.append({
                "role_id": role_id, "role_name": name, "department": dept,
                "category": category, "is_birthright": birthright,
            })
    write_csv(os.path.join(OUT_DIR, "roles.csv"), role_rows,
              ["role_id", "role_name", "department", "category", "is_birthright"])

    # identities.csv
    write_csv(os.path.join(OUT_DIR, "identities.csv"), identities,
              ["identity_id", "name", "division", "department", "section",
               "manager", "manager_department", "title", "lifecycle_state"])

    # assignments.csv
    write_csv(os.path.join(OUT_DIR, "assignments.csv"), assignments,
              ["identity_id", "role_id"])

    # prehire_queue.csv
    write_csv(os.path.join(OUT_DIR, "prehire_queue.csv"), prehire,
              ["identity_id", "name", "division", "department", "section",
               "manager", "manager_department", "title", "lifecycle_state", "start_date"])

    # transfer_queue.csv
    write_csv(os.path.join(OUT_DIR, "transfer_queue.csv"), transfers,
              ["identity_id", "name", "from_division", "from_department", "from_section",
               "from_manager", "from_manager_department", "to_division", "to_department",
               "to_section", "to_manager", "to_manager_department", "effective_date", "reason"])

    print(f"Generated {len(identities)} Active identities")
    print(f"Generated {len(assignments)} role assignments")
    print(f"Generated {len(role_rows)} RBAC roles across {len(ROLES)} departments")
    print(f"Generated {len(prehire)} PreHire identities")
    print(f"Generated {len(transfers)} department transfer cases")


if __name__ == "__main__":
    main()
