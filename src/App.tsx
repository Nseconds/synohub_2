import React, { useState, useEffect } from "react";
import { LayoutDashboard, Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { updateCustomer } from "./frontend/api/customerApi";
import { fetchDashboardData } from "./frontend/api/dashboardApi";
import { createLead, updateLead, updateServiceRequest, createServiceRequest } from "./frontend/api/serviceRequestApi";
import { AppBoundary } from "./frontend/components/AppBoundary";
import { AppLayout } from "./frontend/components/AppLayout";
import { EditModal } from "./frontend/components/EditModal";
import { Header } from "./frontend/components/Header";
import { NotificationToast } from "./frontend/components/NotificationToast";
import { Sidebar } from "./frontend/components/Sidebar";
import { IMPLEMENTATION_TYPES, LEAD_STATUSES, PAYMENT_OPTIONS, REGIONS, REQUESTED_PEOPLE, SALES_PEOPLE, SALES_TYPES, TICKET_STATUSES, LEVEL_1_ASSIGNEES } from "./frontend/constants/options";
import { AiPage } from "./frontend/pages/AiPage";
import { DashboardPage } from "./frontend/pages/DashboardPage";
import { AddServicePage } from "./frontend/pages/AddServicePage";
import { LoginPage } from "./frontend/pages/LoginPage";
import { CustomersPage } from "./frontend/pages/CustomersPage";
import type { Customer, Registration, ServiceTicket } from "./frontend/types";
import { isValidStoredUser } from "./frontend/utils/auth";

export default function App() {
  const [user, setUser] = useState<{ name: string; role: string; token: string } | null>(() => {
    try {
      const saved = localStorage.getItem("synohub-user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidStoredUser(parsed)) {
          return parsed;
        } else {
          localStorage.removeItem("synohub-user");
        }
      }
    } catch {
      try {
        localStorage.removeItem("synohub-user");
      } catch {}
    }
    return null;
  });

  const [activeTab, setActiveTab ] = useState<string>("overview");
  const [requestedPeopleList] = useState<string[]>(REQUESTED_PEOPLE);
  const [prefilledChatPrompt, setPrefilledChatPrompt] = useState("");
  const [data, setData] = useState<{ registrations: Registration[], services: ServiceTicket[], customers: Customer[] }>({ 
    registrations: [], services: [], customers: [] 
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRegion] = useState("All");
  const [filterStatus] = useState("All");

  const [showAllFeed, setShowAllFeed] = useState(false);
  const [editingItem, setEditingItem] = useState<{ type: 'lead' | 'service' | 'customer', data: any } | null>(null);
  const [preselectedCustomer, setPreselectedCustomer] = useState<Customer | null>(null);
  
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setActiveTab("overview");
      setLoading(false);
    };
    window.addEventListener("synohub-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("synohub-auth-expired", handleAuthExpired);
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    fetchData();
    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, [user]);

  const fetchData = async () => {
    try {
      const res: any = await fetchDashboardData();
      setData({
        registrations: res && Array.isArray(res.registrations) ? res.registrations : [],
        services: res && Array.isArray(res.services) ? res.services : [],
        customers: res && Array.isArray(res.customers) ? res.customers : []
      });
    } catch (e: any) {
      console.error("Data fetch failed", e);
      showToast(e.message || "Could not retrieve live logs from client-side state.", "error");
    } finally {
      setLoading(false);
    }
  };

  const filteredRegistrations = (data?.registrations || []).filter(reg => {
    if (!reg) return false;
    const matchesSearch = ((reg.customerName || '').toLowerCase()).includes((searchTerm || '').toLowerCase()) || 
                          ((reg.contactName || '').toLowerCase()).includes((searchTerm || '').toLowerCase());
    const matchesRegion = filterRegion === "All" || reg.region === filterRegion;
    const matchesStatus = filterStatus === "All" || reg.status === filterStatus;
    return matchesSearch && matchesRegion && matchesStatus;
  });

  const filteredCustomers = (data?.customers || []).filter(cust => 
    cust && cust.name && ((cust.name || '').toLowerCase()).includes((searchTerm || '').toLowerCase())
  );

  const navItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "add-service", label: "Add Service", icon: Plus },
    { id: "ai", label: "SynoAI Chat", icon: Sparkles },
  ].filter(() => !!user);

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedUser) => {
          localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
          setUser(loggedUser);
          setActiveTab("overview");
          showToast(`Welcome back, ${loggedUser.name}!`);
        }} 
      />
    );
  }

  const handleLoginSuccessRecovery = (loggedUser: any) => {
    if (!isValidStoredUser(loggedUser)) {
      try {
        localStorage.removeItem("synohub-user");
      } catch {}
      setUser(null);
      return;
    }
    try {
      localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
    } catch {}
    setUser(loggedUser);
    window.location.reload();
  };

  const errorFallback = (
    <LoginPage
      onLoginSuccess={handleLoginSuccessRecovery}
    />
  );

  return (
    <AppBoundary fallback={errorFallback}>
      <AppLayout
        notification={
          <NotificationToast
            notification={notification}
            onClose={() => setNotification(null)}
          />
        }
        sidebar={
          <Sidebar
            activeTab={activeTab}
            navItems={navItems}
            user={user}
            onNavigate={(tabId) => {
              setActiveTab(tabId);
            }}
            onLogout={() => {
              localStorage.removeItem("synohub-user");
              setUser(null);
              showToast("Signed out successfully");
            }}
          />
        }
        header={
          <Header
            activeTab={activeTab}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        }
      >
        <AnimatePresence mode="wait">
          {searchTerm.trim() !== "" ? (
            <div className="bg-[#F8FAFC] min-h-screen p-8">
              <CustomersPage
                searchTerm={searchTerm}
                customers={filteredCustomers}
                registrations={data?.registrations || []}
                actionLabel="Select Customer"
                onSelectCustomer={(cust) => {
                  setPreselectedCustomer(cust);
                  setSearchTerm("");
                  setActiveTab("add-service");
                }}
              />
            </div>
          ) : (
            <>
              {activeTab === "overview" && (
                <DashboardPage
                  registrations={data?.registrations || []}
                  showAllFeed={showAllFeed}
                  onSelectLead={(leadId) => {
                    const selectedReg = data.registrations.find(r => r.id === leadId);
                    if (selectedReg) {
                      setEditingItem({ type: 'lead', data: selectedReg });
                    }
                  }}
                  onToggleShowAllFeed={() => setShowAllFeed(!showAllFeed)}
                />
              )}

              {activeTab === "add-service" && (
                <AddServicePage
                  customers={data?.customers || []}
                  level1Assignees={LEVEL_1_ASSIGNEES}
                  requestedPeopleList={requestedPeopleList}
                  preselectedCustomer={preselectedCustomer}
                  onClearPreselected={() => setPreselectedCustomer(null)}
                  onSubmit={async (payload) => {
                    try {
                      await createServiceRequest(payload);
                      showToast("Service ticket created successfully!");
                      setActiveTab("overview");
                      fetchData();
                    } catch (err: any) {
                      showToast(err.message || "Failed to create service ticket", "error");
                    }
                  }}
                  onClose={() => setActiveTab("overview")}
                />
              )}

              {activeTab === "ai" && (
                <AiPage
                  user={user}
                  staffOptions={requestedPeopleList}
                  forcedInput={prefilledChatPrompt}
                  onInputLoaded={() => setPrefilledChatPrompt("")}
                  onRecordSaved={(savedRecord) => {
                    fetchData();
                    if (savedRecord && savedRecord.type === "service") {
                      showToast(`AI Auto-Saved: Service Ticket for "${savedRecord.customerName}" logged!`, "success");
                    }
                  }}
                />
              )}
            </>
          )}
        </AnimatePresence>
      </AppLayout>

      {/* Database Viewer Modal */}
      {editingItem && (
        <EditModal
          editingItem={editingItem}
          setEditingItem={setEditingItem}
          userRole={user?.role}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (editingItem.type === 'lead') {
                await updateLead(editingItem.data.id, editingItem.data);
              } else if (editingItem.type === 'service') {
                await updateServiceRequest(editingItem.data.id, editingItem.data);
              } else {
                await updateCustomer(editingItem.data.id, editingItem.data);
              }
              setEditingItem(null);
              fetchData();
              showToast("Record details updated successfully.");
            } catch (err: any) {
              showToast(err.message || "Failed to update record details.", "error");
            }
          }}
          regions={REGIONS}
          leadStatuses={LEAD_STATUSES}
          implementationTypes={IMPLEMENTATION_TYPES}
          salesPeople={SALES_PEOPLE}
          ticketStatuses={TICKET_STATUSES}
          paymentOptions={PAYMENT_OPTIONS}
        />
      )}
    </AppBoundary>
  );
}
