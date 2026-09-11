import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeskly } from '../store/desklyStore';
import { TicketPriority, Attachment } from '../types';
import { isV2 } from '../config';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Paperclip,
  AlertTriangle,
  UploadCloud,
  FileText,
  X,
} from 'lucide-react';

export const NewTicketWizard: React.FC = () => {
  const navigate = useNavigate();
  const { createTicket, addToast } = useDeskly();

  // Wizard Step State
  // v1: 1 (Details) -> 2 (Routing) -> 3 (Review)
  // v2: 1 (Details) -> 2 (Routing) -> 3 (Attachments) -> 4 (Review)
  const totalSteps = isV2() ? 4 : 3;
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Authentication');
  const [priority, setPriority] = useState<TicketPriority>('high');
  const [tagsInput, setTagsInput] = useState('Bug, Frontend');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 Validation
  const validateStep1 = () => {
    const errs: { [key: string]: string } = {};
    if (!title.trim()) {
      errs.title = 'Ticket title is required.';
    } else if (title.trim().length < 5) {
      errs.title = 'Title must be at least 5 characters.';
    }

    if (!description.trim()) {
      errs.description = 'Please provide a brief problem description.';
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      addToast({
        type: 'warning',
        title: 'Validation Failed',
        message: errs.title || errs.description,
      });
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (!validateStep1()) return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleAddSampleAttachment = () => {
    const sampleFiles = [
      { id: `att-${Date.now()}-1`, name: 'console-error-dump.log', size: '42 KB', type: 'text/plain' },
      { id: `att-${Date.now()}-2`, name: 'broken-ui-screenshot.png', size: '310 KB', type: 'image/png' },
    ];
    const picked = sampleFiles[attachments.length % sampleFiles.length];
    setAttachments((prev) => [...prev, picked]);
    addToast({
      type: 'info',
      title: 'File Attached',
      message: `Attached ${picked.name}`,
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const created = await createTicket({
      title,
      description,
      priority,
      category,
      tags: parsedTags,
      attachments,
    });

    setIsSubmitting(false);
    navigate(`/tickets/${created.id}`);
  };

  // Step definitions based on v1 vs v2
  const steps = isV2()
    ? [
        { num: 1, label: 'Details' },
        { num: 2, label: 'Routing & Priority' },
        { num: 3, label: 'Attachments' }, // v2 added step!
        { num: 4, label: 'Review & Submit' },
      ]
    : [
        { num: 1, label: 'Details' },
        { num: 2, label: 'Routing & Priority' },
        { num: 3, label: 'Review & Submit' },
      ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/tickets')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              {isV2() ? 'Create New Request' : 'New Support Ticket'}
            </h1>
            <p className="text-xs text-zinc-400">
              {isV2()
                ? 'Step-by-step guided submission with attachment intake'
                : 'Standard 3-step ticket creation wizard'}
            </p>
          </div>
        </div>

        <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
          Step {currentStep} of {totalSteps}
        </span>
      </div>

      {/* Wizard Progress Indicator */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {steps.map((s) => {
          const isCompleted = currentStep > s.num;
          const isCurrent = currentStep === s.num;
          return (
            <div
              key={s.num}
              className={`p-2.5 rounded-xl border transition-all ${
                isCurrent
                  ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300'
                  : isCompleted
                  ? 'bg-zinc-900/60 border-zinc-700 text-zinc-300'
                  : 'bg-zinc-950 border-zinc-900 text-zinc-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCompleted
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : s.num}
                </div>
                <span className="text-xs font-medium truncate">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step Contents */}
      <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 shadow-md">
        {/* Step 1: Details */}
        {currentStep === 1 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <h2 className="text-sm font-semibold text-zinc-100">Step 1: Ticket Details</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Ticket Title <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                data-testid="wizard-title-input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                }}
                placeholder="e.g., Webhook delivery failing with TLS handshake timeout"
                className={`w-full bg-zinc-950 border rounded-lg p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors ${
                  errors.title
                    ? 'border-rose-500 focus:ring-1 focus:ring-rose-500'
                    : 'border-zinc-800 focus:border-indigo-500'
                }`}
              />
              {errors.title && (
                <div
                  data-testid="wizard-title-error"
                  className="flex items-center gap-1.5 text-[11px] text-rose-400 mt-1"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>{errors.title}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="wizard-category-select"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="Authentication">Authentication & SSO</option>
                <option value="Billing">Billing & Payments</option>
                <option value="Security">Security & Compliance</option>
                <option value="Infrastructure">Infrastructure & API</option>
                <option value="UI/UX">UI & Accessibility</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Detailed Description <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={4}
                data-testid="wizard-description-input"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
                }}
                placeholder="Include error codes, steps to reproduce, and impact on customers..."
                className={`w-full bg-zinc-950 border rounded-lg p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors ${
                  errors.description
                    ? 'border-rose-500 focus:ring-1 focus:ring-rose-500'
                    : 'border-zinc-800 focus:border-indigo-500'
                }`}
              />
              {errors.description && (
                <div className="flex items-center gap-1.5 text-[11px] text-rose-400 mt-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{errors.description}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Routing & Priority */}
        {currentStep === 2 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <h2 className="text-sm font-semibold text-zinc-100">Step 2: Routing & Priority</h2>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-2">
                Severity / Priority Level
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    data-testid={`wizard-priority-${p}`}
                    className={`p-2.5 rounded-xl border text-xs font-medium capitalize transition-all ${
                      priority === p
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-sm'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Initial Tags (Comma separated)
              </label>
              <input
                type="text"
                data-testid="wizard-tags-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. Ingestion, P0, Auth"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}

        {/* Step 3 (v2 ONLY): Attachments Intake */}
        {isV2() && currentStep === 3 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Step 3: Attach Diagnostic Logs</h2>
                <p className="text-[11px] text-indigo-400">
                  ★ v2 Redesign Step: Added to streamline log triage before review
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddSampleAttachment}
                data-testid="wizard-add-file-btn"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span>Simulate Upload</span>
              </button>
            </div>

            {/* Dropzone mock */}
            <div
              onClick={handleAddSampleAttachment}
              data-testid="wizard-dropzone"
              className="p-8 border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 rounded-2xl bg-zinc-950/60 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <UploadCloud className="w-8 h-8 text-zinc-500" />
              <div className="text-xs font-medium text-zinc-300">
                Click to attach logs, screenshots, or error traces
              </div>
              <div className="text-[10px] text-zinc-500">Supports PNG, PDF, LOG up to 25MB</div>
            </div>

            {/* Attached files list */}
            {attachments.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase">Attached Files</div>
                {attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      <span className="font-medium text-zinc-200">{file.name}</span>
                      <span className="text-[10px] text-zinc-500">({file.size})</span>
                    </div>
                    <button
                      onClick={() => handleRemoveAttachment(file.id)}
                      className="text-zinc-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Final Step: Review & Submit (Step 3 in v1, Step 4 in v2) */}
        {((!isV2() && currentStep === 3) || (isV2() && currentStep === 4)) && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <h2 className="text-sm font-semibold text-zinc-100">Review & Confirm Submission</h2>

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 text-xs">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-zinc-500 text-[10px] uppercase font-semibold">Title</span>
                  <div className="text-sm font-bold text-zinc-100 mt-0.5">{title || 'Untitled Ticket'}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {priority}
                </span>
              </div>

              <div>
                <span className="text-zinc-500 text-[10px] uppercase font-semibold">Category</span>
                <div className="text-zinc-300 mt-0.5">{category}</div>
              </div>

              <div>
                <span className="text-zinc-500 text-[10px] uppercase font-semibold">Description</span>
                <div className="text-zinc-300 mt-0.5 whitespace-pre-wrap">{description}</div>
              </div>

              {isV2() && (
                <div>
                  <span className="text-zinc-500 text-[10px] uppercase font-semibold">
                    Attached Files ({attachments.length})
                  </span>
                  <div className="text-zinc-400 mt-0.5">
                    {attachments.length > 0
                      ? attachments.map((a) => a.name).join(', ')
                      : 'None'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Wizard Footer Controls */}
        <div className="flex items-center justify-between pt-6 mt-6 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            data-testid="wizard-back-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 disabled:opacity-40 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          {currentStep < totalSteps ? (
            <button
              type="button"
              onClick={handleNext}
              data-testid="wizard-next-btn"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm shadow-indigo-600/30 transition-all active:scale-98"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="wizard-submit-btn"
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/30 transition-all active:scale-98 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Creating Ticket...' : 'Confirm & Create Ticket'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
