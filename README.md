# AI-Based RBAC Role Recommendation System

A Flask web application that recommends SailPoint ISC RBAC roles to new
joiners (PreHire) and employees undergoing a department transfer, using a
peer-similarity machine learning approach (weighted cosine-style similarity
over identity-role assignment vectors, with `scikit-learn`).

This project simulates the account-management workflow that sits on top of
an already-completed enterprise RBAC implementation in SailPoint Identity
Security Cloud (ISC).

## Project Structure

```
rbac_app/
├── app.py                     # Flask application (routes / API)
├── requirements.txt
├── data/
│   ├── generate_dataset.py    # synthetic dataset generator
│   ├── identities.csv         # Active identities (org attributes)
│   ├── roles.csv               # RBAC role catalogue per department
│   ├── assignments.csv         # identity -> role assignment matrix (long format)
│   ├── prehire_queue.csv       # PreHire identities awaiting recommendation
│   └── transfer_queue.csv      # Active identities mid department-transfer
├── models/
│   └── recommender.py          # core ML recommendation engine
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

## Setup

```bash
cd rbac_app
pip install -r requirements.txt

# (Re)generate the synthetic dataset (already included, but reproducible)
python data/generate_dataset.py

# Run the app
python app.py
```

Then open **http://127.0.0.1:5000** in a browser.

## How It Works

1. **Identity Queue** (left sidebar) lists PreHire identities (new joiners
   awaiting role assignment) and Active identities undergoing a department
   transfer.
2. Selecting an identity calls the Flask API, which runs the recommendation
   engine live (`models/recommender.py`) and returns scored role
   recommendations.
3. **PreHire flow**: birthright roles are pre-selected and locked;
   peer-recommended roles can be added to the access request; submitting
   shows a simulated SailPoint ISC `/v3/access-requests` API payload.
4. **Department Transfer flow**: in addition to new-department
   recommendations, the engine looks up the employee's currently-assigned
   roles in their old department and flags them for revocation. The
   reviewer can choose to keep specific roles. Submitting generates both a
   REVOKE and a GRANT payload preview.
5. **Methodology tab**: explains the weighting formula, scoring thresholds,
   and the true cosine-similarity peer-diagnostic function in plain
   language, for use during a viva / demo walkthrough.

## Recommendation Engine Summary

See `models/recommender.py` docstrings for full detail. In short:

- Each Active identity is represented as a binary vector over their
  department's role catalogue.
- Each candidate peer is given an organisational-distance weight based on
  matching section / manager / department / manager-department / division,
  raised to the 4th power to sharply favour close peers over a large
  population of weakly-related ones.
- For each candidate role, a weighted mean adoption rate is computed across
  all peers, weighted by the above. This score (0-100) classifies the role
  as **Birthright**, **Recommended**, or **Optional**.
- A separate function (`peer_similarity_ranking`) computes genuine cosine
  similarity (`sklearn.metrics.pairwise.cosine_similarity`) between full
  role-assignment vectors, used for Active-to-Active peer diagnostics.

## Regenerating the Dataset

The dataset is synthetic but structurally realistic: each section has a
single dedicated manager, and the probability of holding each role within
a section is fixed in `SECTION_ROLE_PROBABILITY` (data/generate_dataset.py),
producing a learnable, explainable pattern for the recommender to surface.
Re-run `python data/generate_dataset.py` at any time to regenerate (uses a
fixed random seed for reproducibility).

## Notes for Production Use

This is an academic/demo implementation. In a production SailPoint ISC
deployment, `data/identities.csv`, `roles.csv`, and `assignments.csv` would
instead be populated by calling the ISC REST API (`/v3/identities`,
`/v3/roles`, `/v3/identities/{id}/role-assignments`) on a scheduled basis,
and the `/api/submit` endpoint would make a real authenticated POST to
`/v3/access-requests` rather than simulating the response.
