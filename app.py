"""
app.py
-------
Flask web application for the AI-Based RBAC Role Recommendation System.

Simulates the account-management workflow that would normally sit on top
of SailPoint Identity Security Cloud (ISC):

    1. PreHire queue       -> recommend roles for new joiners
    2. Department Transfer queue -> recommend roles for new dept,
                                      flag old-dept roles for revocation
    3. Submission           -> preview the ISC /v3/access-requests API
                                payload that would be sent in production

Run with:
    python app.py
Then open http://127.0.0.1:5000/
"""

import os
import sys
import json
import random
from datetime import datetime

from flask import Flask, render_template, jsonify, request

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from models.recommender import RBACRecommender

app = Flask(__name__)
engine = RBACRecommender()

# in-memory submission log (simulates what would be persisted server-side
# / sent to ISC in a production deployment)
SUBMISSION_LOG = []


def identity_to_dict(row):
    return {
        "identity_id": row["identity_id"],
        "name": row["name"],
        "division": row["division"],
        "department": row["department"],
        "section": row["section"],
        "manager": row["manager"],
        "manager_department": row["manager_department"],
        "title": row["title"],
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/queue")
def api_queue():
    """Return PreHire + Transfer queues for the sidebar."""
    prehire = engine.prehire.to_dict(orient="records")
    transfers = engine.transfers.to_dict(orient="records")
    active_count = int((engine.identities["lifecycle_state"] == "Active").sum())
    return jsonify({
        "prehire": prehire,
        "transfers": transfers,
        "active_count": active_count,
    })


@app.route("/api/prehire/<identity_id>/recommendations")
def api_prehire_recommendations(identity_id):
    row = engine.prehire[engine.prehire["identity_id"] == identity_id]
    if row.empty:
        return jsonify({"error": "identity not found"}), 404
    row = row.iloc[0]
    target_attrs = {
        "division": row["division"], "department": row["department"],
        "section": row["section"], "manager": row["manager"],
        "manager_department": row["manager_department"],
    }
    recommendations = engine.recommend_roles(target_attrs)
    peers = engine.get_peers(target_attrs)
    return jsonify({
        "identity": identity_to_dict(row),
        "recommendations": recommendations,
        "peers": peers,
        "peer_count": len(peers),
    })


@app.route("/api/transfer/<identity_id>/recommendations")
def api_transfer_recommendations(identity_id):
    row = engine.transfers[engine.transfers["identity_id"] == identity_id]
    if row.empty:
        return jsonify({"error": "identity not found"}), 404
    row = row.iloc[0]

    target_attrs = {
        "division": row["to_division"], "department": row["to_department"],
        "section": row["to_section"], "manager": row["to_manager"],
        "manager_department": row["to_manager_department"],
    }
    recommendations = engine.recommend_roles(target_attrs)
    peers = engine.get_peers(target_attrs)
    current_roles = engine.get_current_roles(row["identity_id"])

    return jsonify({
        "identity": {
            "identity_id": row["identity_id"],
            "name": row["name"],
            "from_division": row["from_division"], "from_department": row["from_department"],
            "from_section": row["from_section"], "from_manager": row["from_manager"],
            "from_manager_department": row["from_manager_department"],
            "to_division": row["to_division"], "to_department": row["to_department"],
            "to_section": row["to_section"], "to_manager": row["to_manager"],
            "to_manager_department": row["to_manager_department"],
            "effective_date": row["effective_date"], "reason": row["reason"],
        },
        "recommendations": recommendations,
        "peers": peers,
        "current_roles": current_roles,
    })


@app.route("/api/submit", methods=["POST"])
def api_submit():
    """Simulate submission to SailPoint ISC's /v3/access-requests endpoint.
    No real external call is made; this returns a synthetic ISC-style
    response and logs the submission in-memory for the Activity Log."""
    payload = request.get_json()
    request_id = f"REQ-ISC-{random.randint(10000, 99999)}"
    timestamp = datetime.utcnow().isoformat() + "Z"

    record = {
        "request_id": request_id,
        "timestamp": timestamp,
        "identity_id": payload.get("identity_id"),
        "identity_name": payload.get("identity_name"),
        "kind": payload.get("kind"),  # "prehire" or "transfer"
        "grant_roles": payload.get("grant_roles", []),
        "revoke_roles": payload.get("revoke_roles", []),
    }
    SUBMISSION_LOG.append(record)

    return jsonify({
        "status": "submitted",
        "request_id": request_id,
        "timestamp": timestamp,
        "isc_endpoint": "/v3/access-requests",
        "message": "Access request(s) queued for ISC approval workflow.",
    })


@app.route("/api/activity-log")
def api_activity_log():
    return jsonify({"submissions": list(reversed(SUBMISSION_LOG))})


@app.route("/api/stats")
def api_stats():
    """Summary statistics for the dashboard header / report appendix."""
    total_identities = len(engine.identities) + len(engine.prehire) + len(engine.transfers)
    return jsonify({
        "active_identities": int(len(engine.identities)),
        "prehire_pending": int(len(engine.prehire)),
        "transfers_pending": int(len(engine.transfers)),
        "total_roles": int(len(engine.roles)),
        "total_assignments": int(len(engine.assignments)),
        "departments": sorted(engine.identities["department"].unique().tolist()),
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
