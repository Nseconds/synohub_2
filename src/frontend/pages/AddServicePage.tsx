import React, { useState, useEffect, useRef } from "react";
import { RefreshCw, X, Sparkles, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Customer } from "../types";
import { TICKET_STATUSES, PAYMENT_OPTIONS, INVOICE_STATUSES, PAYMENT_STATUSES } from "../constants/options";

interface AddServicePageProps {
  customers: Customer[];
  level1Assignees: string[];
  requestedPeopleList: string[];
  preselectedCustomer?: Customer | null;
  onClearPreselected?: () => void;
  onSubmit: (payload: any) => Promise<void>;
  onClose: () => void;
  currentUser?: { name: string; role: string; token: string } | null;
}

export const AddServicePage = ({
  customers,
  level1Assignees,
  requestedPeopleList,
  preselectedCustomer,
  onClearPreselected,
  onSubmit,
  onClose,
  currentUser,
}: AddServicePageProps) => {
  const [search, setSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    if (preselectedCustomer) {
      handleSelectCustomer(preselectedCustomer);
      if (onClearPreselected) onClearPreselected();
    }
  }, [preselectedCustomer]);
  
  // Form fields
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("New");
  const [quantity, setQuantity] = useState<number>(1);
  const [assignee, setAssignee] = useState("Select");
  const [requestedPerson, setRequestedPerson] = useState(currentUser?.name || "");
  const [payment, setPayment] = useState("Applicable");
  const [invoiceStatus, setInvoiceStatus] = useState("Not Invoiced");
  const [amount, setAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("Not Paid");
  
  // Location fields
  const [showLocation, setShowLocation] = useState(false);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");

  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Filter customers based on search input
  const filteredCustomers = customers.filter(c => 
    c && c.name && c.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomer(cust);
    setSearch(cust.name);
    setShowSuggestions(false);
    // Auto-populate location details if present
    if (cust.address) setNote(cust.address);
  };

  const handleRefresh = () => {
    setSelectedCustomer(null);
    setSearch("");
    setShowSuggestions(false);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    const payload = {
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      contactName: selectedCustomer.contactName || "",
      phone: selectedCustomer.phone || "",
      email: selectedCustomer.email || "",
      address: selectedCustomer.address || "",
      description,
      status,
      quantity,
      requestedPerson,
      paymentStatus: paymentStatus,
      paymentOption: payment,
      invoiceStatus,
      amount,
      assignee: assignee !== "Select" ? assignee : undefined,
      accessories: showLocation ? note : undefined,
      mapLink: showLocation ? link : undefined,
    };

    await onSubmit(payload);
  };

  // Helper to resolve Locator Username
  const resolvedUsername = selectedCustomer 
    ? (selectedCustomer.customerUsername || selectedCustomer.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)) 
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      className="bg-white rounded border border-zinc-200 overflow-hidden flex flex-col h-full max-w-4xl mx-auto my-4 font-sans"
    >
      {/* Header */}
      <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-3 flex items-center justify-between">
        <h2 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider">
          <Sparkles size={14} className="text-[#00ADC6]" /> Add Service Request
        </h2>
        <button
          onClick={onClose}
          type="button"
          className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Content Form */}
      <form onSubmit={handleFormSubmit} className="p-6 space-y-4 flex-1 overflow-y-auto bg-white">
        <div className="relative space-y-1">
          <label className="text-xs font-medium text-zinc-650 flex items-center gap-0.5">
            Select Customers: <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type to select..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowSuggestions(true);
                if (selectedCustomer && e.target.value !== selectedCustomer.name) {
                  setSelectedCustomer(null);
                }
              }}
              onFocus={() => setShowSuggestions(true)}
              className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20"
            />
            <button
              type="button"
              onClick={handleRefresh}
              className="bg-[#64748b] hover:bg-[#475569] text-white rounded px-4 flex items-center justify-center transition-colors cursor-pointer"
              title="Clear selected customer"
            >
              <RefreshCw size={14} className="rotate-90" />
            </button>
          </div>

          {/* Autocomplete Dropdown */}
          <AnimatePresence>
            {showSuggestions && search.trim() !== "" && filteredCustomers.length > 0 && (
              <motion.div
                ref={suggestionsRef}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute left-0 right-12 z-50 bg-white border border-[#E2E8F0] rounded-xl shadow-xl max-h-56 overflow-y-auto mt-1.5 divide-y divide-zinc-100"
              >
                {filteredCustomers.slice(0, 10).map((cust) => (
                  <div
                    key={`suggest-${cust.id}`}
                    onClick={() => handleSelectCustomer(cust)}
                    className="px-4 py-3 text-xs text-zinc-750 hover:bg-teal-50/50 cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-zinc-950">{cust.name}</div>
                      {cust.contactName && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          Contact: {cust.contactName} ({cust.phone || "No phone"})
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] bg-zinc-100 text-zinc-500 font-semibold px-2 py-0.5 rounded-full font-mono uppercase">
                      ID #{cust.id}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Selected Customer Details Card */}
        <AnimatePresence>
          {selectedCustomer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border border-[#00ADC6]/30 rounded p-4 bg-zinc-50/50 text-xs text-zinc-500 space-y-1 shadow-sm font-sans"
            >
              <div>
                Implementation Type: <span className="text-zinc-800 font-medium">{selectedCustomer.implementationType || "LOCATOR"}</span>
              </div>
              <div>
                Contact Name: <span className="text-zinc-800 font-medium">{selectedCustomer.contactName || ""}</span>
              </div>
              <div>
                Phone: <span className="text-zinc-800 font-medium">{selectedCustomer.phone || ""}</span>
              </div>
              <div>
                Email: <span className="text-zinc-800 font-medium">{selectedCustomer.email || ""}</span>
              </div>
              <div>
                Address: <span className="text-zinc-800 font-medium">{selectedCustomer.address || ""}</span>
              </div>
              <div>
                Region: <span className="text-zinc-800 font-medium">{selectedCustomer.region || ""}</span>
              </div>
              <div>
                Locator Username: <span className="text-zinc-800 font-medium">{resolvedUsername || ""}</span>
              </div>
              <div>
                Vehicle Count: <span className="text-zinc-800 font-medium">{selectedCustomer.vehicleCount || 0}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ticket Details Fields */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-650 flex items-center gap-0.5">
              Description: <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide a detailed description of the service request..."
              className="w-full bg-white border border-zinc-300 rounded p-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 resize-none font-medium"
            />
          </div>

          {/* Location Toggle Button & Fields */}
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowLocation(!showLocation)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#0ea5e9] text-[#0ea5e9] text-xs font-semibold bg-white hover:bg-sky-50/50 transition-colors cursor-pointer"
              >
                <Plus size={13} className={showLocation ? "rotate-45 transition-transform" : "transition-transform"} /> Location
              </button>
            </div>

            <AnimatePresence>
              {showLocation && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Note:</label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="space-y-1 relative">
                    <label className="text-xs font-medium text-zinc-600">Link:</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        className="flex-1 bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setNote("");
                          setLink("");
                          setShowLocation(false);
                        }}
                        className="border border-rose-500 hover:bg-rose-50 text-rose-500 rounded px-3.5 flex items-center justify-center transition-colors cursor-pointer"
                        title="Remove Location info"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Grid fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Status:</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {TICKET_STATUSES.map((ts) => (
                  <option key={ts} value={ts}>
                    {ts}
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">
                Quantity: <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                required
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-855 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Level 1 Assignee */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Level 1 Assignee:</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="Select">Select</option>
                {level1Assignees.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </div>

            {/* Requested Person */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">
                Requested Person:
              </label>
              <select
                value={requestedPerson}
                onChange={(e) => setRequestedPerson(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="">Select requested person</option>
                {currentUser?.name && !requestedPeopleList.includes(currentUser.name) && (
                  <option value={currentUser.name}>{currentUser.name}</option>
                )}
                {requestedPeopleList.map((rp) => (
                  <option key={rp} value={rp}>
                    {rp}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Payment:</label>
              <select
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {PAYMENT_OPTIONS.map((po) => (
                  <option key={po} value={po}>
                    {po}
                  </option>
                ))}
              </select>
            </div>

            {/* Invoice Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Invoice Status:</label>
              <select
                value={invoiceStatus}
                onChange={(e) => setInvoiceStatus(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {INVOICE_STATUSES.map((is) => (
                  <option key={is} value={is}>
                    {is}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Amount:</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-855 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Payment Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Payment Status:</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="w-full bg-[#f8fafc] border border-zinc-300 rounded px-3 py-2 text-xs text-zinc-850 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {PAYMENT_STATUSES.map((ps) => (
                  <option key={ps} value={ps}>
                    {ps}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-[#5b6c7c] hover:bg-[#4d5b69] text-white text-xs font-semibold rounded transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={!selectedCustomer}
            className="px-6 py-2 bg-gradient-to-r from-[#00ADC6] to-[#018698] hover:opacity-90 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed text-white text-xs font-semibold rounded transition-colors cursor-pointer"
          >
            Submit Request
          </button>
        </div>
      </form>
    </motion.div>
  );
};
