import React, { useState, useRef } from 'react';
import { Upload, MapPin, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { AgentTrace, Complaint, UserLocation } from '../types';
import { createComplaint } from '../services';
import { AgentActivityPanel } from './AgentActivityPanel';
import { NearMePanel } from './NearMePanel';

interface ReportIssueProps {
  onSubmit: (complaint: Complaint) => void;
  userLocation: UserLocation | null;
  onLocationChange: (location: UserLocation) => void;
}

export const ReportIssue: React.FC<ReportIssueProps> = ({ onSubmit, userLocation, onLocationChange }) => {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [textNote, setTextNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agentTrace, setAgentTrace] = useState<AgentTrace[]>([]);
  const [recommendation, setRecommendation] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimeoutRef = useRef<number | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (file.type.startsWith('image/')) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      setAgentTrace([]);
      setRecommendation('');
    }
  };

  const showErrorToast = (message: string) => {
    setErrorMessage(message);
    if (errorTimeoutRef.current) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => setErrorMessage(''), 5000);
  };

  const handleSubmit = async () => {
    if (isSubmitting || (!photoFile && !textNote.trim())) return;

    setIsSubmitting(true);
    setAgentTrace([]);
    setRecommendation('');
    try {
      const result = await createComplaint({
        textNote,
        photoFile,
        ward: userLocation?.ward ?? 8,
        locality: userLocation?.locality ?? 'Ameerpet',
        lat: userLocation?.lat,
        lng: userLocation?.lng,
        source: 'Citizen App',
      });

      setAgentTrace(result.trace);
      setRecommendation(result.recommendation ?? '');
      onSubmit(result.complaint);
      
      const stored = JSON.parse(localStorage.getItem('civicpulse_my_reports') || '[]');
      stored.unshift({
        id: result.complaint.id,
        locality: result.complaint.locality,
        category: result.complaint.category,
        submittedAt: new Date().toISOString()
      });
      localStorage.setItem('civicpulse_my_reports', JSON.stringify(stored));

      setShowSuccess(true);

      setTimeout(() => {
        setShowSuccess(false);
        setPhotoFile(null);
        setPhotoPreview(null);
        setTextNote('');
      }, 3000);
    } catch {
      showErrorToast('Unable to submit this report to the shared backend.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-brand-teal px-6 py-4">
          <h2 className="text-xl font-semibold text-white">Report a Civic Issue</h2>
          <p className="text-sm text-green-100 mt-1">Upload a photo or describe the problem</p>
        </div>

        <div className="p-6 space-y-6">
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
              dragActive
                ? 'border-brand-teal bg-teal-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files && handleFile(e.target.files[0])}
              className="hidden"
            />

            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Uploaded"
                  className="max-h-48 mx-auto rounded-lg"
                />
                <button
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                    setAgentTrace([]);
                    setRecommendation('');
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                >
                  <AlertCircle size={16} />
                </button>
              </div>
            ) : (
              <div
                className="cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-gray-50 rounded-full">
                    <Upload className="text-gray-400" size={32} />
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Drag and drop an image here, or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  PNG, JPG up to 10MB
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
              <FileText size={16} />
              Additional Details (optional)
            </label>
            <textarea
              value={textNote}
              onChange={(e) => {
                setTextNote(e.target.value);
                setAgentTrace([]);
                setRecommendation('');
              }}
              placeholder="Describe the issue (e.g., 'Large pothole near the intersection causing traffic delays')"
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5C56] focus:border-transparent resize-none"
              rows={3}
            />
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center gap-3">
            <MapPin size={20} className="text-brand-teal" />
            <div>
              <p className="text-sm font-medium text-gray-700">Location Detected</p>
              <p className="text-xs text-gray-500">
                {userLocation?.label ?? 'Ameerpet, Ward 8'}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (!photoFile && !textNote.trim())}
              className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all ${
                isSubmitting || (!photoFile && !textNote.trim())
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-brand-teal text-white hover:bg-[#0a4a45] shadow-sm'
              }`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Running agent pipeline...
                </span>
              ) : (
                'Submit Report'
              )}
            </button>
          </div>
        </div>
      </div>

      <NearMePanel onLocationChange={onLocationChange} />

      <AgentActivityPanel trace={agentTrace} isRunning={isSubmitting} recommendation={recommendation} />

      {showSuccess && (
        <div className="fixed bottom-8 right-8 bg-brand-teal text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up">
          <CheckCircle size={24} />
          <div>
            <p className="font-medium">Report Submitted Successfully</p>
            <p className="text-sm text-green-100">Your complaint has been registered</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="fixed bottom-8 left-8 bg-brand-terracotta text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up max-w-md">
          <AlertCircle size={24} />
          <div>
            <p className="font-medium">AI Service Fallback</p>
            <p className="text-sm text-red-50">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
};
