import React, { useState } from "react";

const TOPICS = [
  { title: "What is Intelligence?", description: "Intelligence is information that has been checked and organized to help your commander make decisions." },
  { title: "What to Look For on Patrol", description: "Movement, vehicles, strangers, weapons, changes to the area. If something feels wrong, report it." },
  { title: "How to Write a Good Report", description: "Write facts. Write what you saw. Write when and where. Do not guess. Do not add opinion." },
  { title: "Source Reliability", description: "How to judge if information from a person can be trusted." },
  { title: "The Patrol Cycle", description: "Plan, prepare, execute, report. Every patrol follows the same steps." },
  { title: "Map Reading Basics", description: "How to find a location on a map and describe it to others." },
];

export default function Reference() {
  const [open, setOpen] = useState(null);
  return (
    <div className="card reference-view">
      <h2>Reference</h2>
      <p className="tab-intro">Short field lessons for operators. Use these as quick reminders while working.</p>
      <div className="reference-grid">
        {TOPICS.map((topic, index) => {
          const active = open === index;
          return (
            <button
              key={topic.title}
              type="button"
              className={`reference-card ${active ? "active" : ""}`}
              onClick={() => setOpen(active ? null : index)}
            >
              <strong>{topic.title}</strong>
              <span>{topic.description}</span>
              {active && <em>Full content will be added before deployment.</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
