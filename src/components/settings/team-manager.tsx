"use client";

import { useState } from "react";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  X,
  Shield,
  ShieldCheck,
} from "lucide-react";

interface Employee {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface Props {
  employees: Employee[];
}

const ROLES = [
  { value: "admin", label: "Admin", color: "bg-purple-600", desc: "Full access to everything" },
  { value: "va", label: "VA", color: "bg-blue-600", desc: "Orders & Parcels + Time Tracker" },
  { value: "fulfillment", label: "Fulfillment", color: "bg-green-600", desc: "Orders, Inventory + Time Tracker" },
  { value: "marketing", label: "Marketing", color: "bg-orange-600", desc: "Ads + Time Tracker" },
];

export function TeamManager({ employees: initialEmployees }: Props) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState("va");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const showSuccessMsg = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const resetForm = () => {
    setShowAdd(false);
    setEditingId(null);
    setFormEmail("");
    setFormName("");
    setFormRole("va");
    setError(null);
  };

  const handleAdd = async () => {
    if (!formEmail.trim()) { setError("Email is required"); return; }
    if (!formName.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formEmail.trim(), full_name: formName.trim(), role: formRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add");
      showSuccessMsg(`${formName} added as ${formRole}`);
      resetForm();
      // Refresh
      const refreshRes = await fetch("/api/team");
      const refreshJson = await refreshRes.json();
      if (refreshRes.ok) setEmployees(refreshJson.employees || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add employee");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, full_name: formName.trim(), role: formRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      setEmployees((prev) =>
        prev.map((e) => e.id === editingId ? { ...e, full_name: formName, role: formRole } : e)
      );
      showSuccessMsg("Employee updated");
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (emp: Employee) => {
    try {
      const res = await fetch("/api/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: emp.id, is_active: !emp.is_active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      setEmployees((prev) =>
        prev.map((e) => e.id === emp.id ? { ...e, is_active: !emp.is_active } : e)
      );
      showSuccessMsg(`${emp.full_name} ${!emp.is_active ? "activated" : "deactivated"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`Remove ${emp.full_name} (${emp.email})? They will no longer be able to access the dashboard.`)) return;
    try {
      const res = await fetch(`/api/team?id=${emp.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to remove");
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
      showSuccessMsg(`${emp.full_name} removed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setShowAdd(false);
    setFormEmail(emp.email);
    setFormName(emp.full_name);
    setFormRole(emp.role);
    setError(null);
  };

  const getRoleInfo = (role: string) => ROLES.find((r) => r.value === role) || ROLES[1];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/20 rounded-lg">
              <Users size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Team Members ({employees.length})
              </h2>
              <p className="text-sm text-gray-400">
                Manage who can access the dashboard and their roles
              </p>
            </div>
          </div>
          {!showAdd && !editingId && (
            <button
              onClick={() => { setShowAdd(true); resetForm(); setShowAdd(true); }}
              className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <Plus size={14} />
              Add Member
            </button>
          )}
        </div>

        {success && (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm flex items-center gap-2">
            <CheckCircle size={16} />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Role legend */}
        <div className="flex flex-wrap gap-3 mb-4">
          {ROLES.map((r) => (
            <div key={r.value} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${r.color}`} />
              <span className="font-medium text-gray-400">{r.label}</span>
              <span>— {r.desc}</span>
            </div>
          ))}
        </div>

        {/* Employee list */}
        {employees.length > 0 && (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const roleInfo = getRoleInfo(emp.role);
                  return (
                    <tr key={emp.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                      <td className="px-3 py-3 text-white font-medium">{emp.full_name}</td>
                      <td className="px-3 py-3 text-gray-400 text-xs font-mono">{emp.email}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${roleInfo.color}`}>
                          {emp.role === "admin" ? <ShieldCheck size={10} /> : <Shield size={10} />}
                          {roleInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          emp.is_active
                            ? "bg-green-900/30 text-green-400"
                            : "bg-gray-700/50 text-gray-500"
                        }`}>
                          {emp.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(emp)}
                            className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                            title="Edit role"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleToggleActive(emp)}
                            className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                            title={emp.is_active ? "Deactivate" : "Activate"}
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(emp)}
                            className="p-1.5 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add / Edit Form */}
        {(showAdd || editingId) && (
          <div className="bg-gray-700/30 border border-gray-600/50 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">
                {editingId ? "Edit Member" : "Add New Member"}
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {!editingId && (
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="employee@gmail.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must match the Google account they&apos;ll use to sign in
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Full Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Juan Dela Cruz"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setFormRole(r.value)}
                    className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      formRole === r.value
                        ? "border-purple-500 bg-purple-500/10"
                        : "border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${r.color}`} />
                      <span className={`text-sm font-medium ${formRole === r.value ? "text-white" : "text-gray-300"}`}>
                        {r.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{r.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={editingId ? handleUpdate : handleAdd}
              disabled={saving}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {saving && <RefreshCw size={14} className="animate-spin" />}
              {saving ? "Saving..." : editingId ? "Update Member" : "Add Member"}
            </button>
          </div>
        )}

        {employees.length === 0 && !showAdd && (
          <div className="py-6 text-center text-gray-500 text-sm">
            No team members yet. Click &quot;Add Member&quot; to invite your first employee.
          </div>
        )}
      </div>
    </div>
  );
}
