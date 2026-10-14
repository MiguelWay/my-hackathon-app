import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";

interface Customer {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
}

export function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setItems(await api.get<Customer[]>("/admin/customers"));
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/customers", { name });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  async function addAdmin(id: number) {
    const email = window.prompt("Admin email for this customer:");
    if (!email) return;
    const password = window.prompt("Temporary password (min 8 characters):");
    if (!password) return;
    try {
      await api.post(`/admin/customers/${id}/admins`, { email, password });
      window.alert("Admin created.");
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div>
      <h1>Customers</h1>

      <form className="card inline" onSubmit={create}>
        <h2>New customer</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button>Create</button>
      </form>

      {error && <p className="error">{error}</p>}

      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Users</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>{c.user_count}</td>
              <td>
                <button type="button" onClick={() => addAdmin(c.id)}>
                  Add admin
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
