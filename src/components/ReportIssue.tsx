import React, { useState, useRef } from 'react';
import { Upload, Camera, MapPin, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { Complaint } from '../types';
import { classifyComplaint, ClassificationResult } from '../services/classificationService';

interface ReportIssueProps {
  onSubmit: (complaint: Complaint) => void;
}

const categoryDescriptions: Partial<Record<string, string>> = {
  'Garbage Overflow': 'Waste management issue requiring cleanup',
  'Pothole / Road Damage': 'Infrastructure damage affecting traffic',
  'Water Leakage': 'Water infrastructure problem',
  'Streetlight Outage': 'Public lighting issue',
  'Drainage Blockage': 'Drainage system blockage',
  'Stray Animal Hazard': 'Animal-related public safety concern',
};

export const ReportIssue: React.FC<ReportIssueProps> = ({ onSubmit }) => {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [textNote, setTextNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
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
      setClassification(null);
    }
  };

  const handleClassify = async () => {
    setIsSubmitting(true);
    try {
      const result = await classifyComplaint(photoFile, textNote);
      setClassification(result);
      if (result.fallback && result.error) {
        showErrorToast(result.error);
      }
    } catch {
      showErrorToast('Unable to classify this report right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showErrorToast = (message: string) => {
    setErrorMessage(message);
    if (errorTimeoutRef.current) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => setErrorMessage(''), 5000);
  };

  const handleSubmit = () => {
    if (!classification) return;

    const complaint: Complaint = {
      id: `CMP-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`.toUpperCase(),
      ward: Math.floor(Math.random() * 12) + 1,
      category: classification.category,
      severity: classification.severity,
      reportedAt: new Date(),
      resolved: false,
      daysOpen: 1,
      lat: 12.9716 + (Math.random() - 0.5) * 0.08,
      lng: 77.5946 + (Math.random() - 0.5) * 0.08,
      source: 'Citizen App',
      address: 'Central Transit Hub, Ward 8',
      description: textNote,
    };

    onSubmit(complaint);
    setShowSuccess(true);

    setTimeout(() => {
      setShowSuccess(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      setTextNote('');
      setClassification(null);
    }, 3000);
  };

  const severityColors = ['#22C55E', '#84CC16', '#EAB308', '#F97316', '#E85D4C'];
  const severityLabels = ['Low', 'Low-Medium', 'Medium', 'Medium-High', 'High'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-[#0E5C56] px-6 py-4">
          <h2 className="text-xl font-semibold text-white">Report a Civic Issue</h2>
          <p className="text-sm text-green-100 mt-1">Upload a photo or describe the problem</p>
        </div>

        <div className="p-6 space-y-6">
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
              dragActive
                ? 'border-[#0E5C56] bg-teal-50'
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
                    setClassification(null);
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
                setClassification(null);
              }}
              placeholder="Describe the issue (e.g., 'Large pothole near the intersection causing traffic delays')"
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5C56] focus:border-transparent resize-none"
              rows={3}
            />
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center gap-3">
            <MapPin size={20} className="text-[#0E5C56]" />
            <div>
              <p className="text-sm font-medium text-gray-700">Location Detected</p>
              <p className="text-xs text-gray-500">Central Transit Hub, Ward 8</p>
            </div>
          </div>

          {classification && (
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={20} className="text-[#0E5C56]" />
                <span className="font-medium text-[#0E5C56]">Issue Classified</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <span className="px-3 py-1.5 bg-white rounded-full text-sm font-medium border border-gray-200">
                  {classification.category}
                </span>
                <span
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: severityColors[classification.severity - 1] }}
                >
                  Severity: {severityLabels[classification.severity - 1]}
                </span>
              </div>
              {categoryDescriptions[classification.category] && (
                <p className="text-xs text-gray-500 mt-3">
                  {categoryDescriptions[classification.category]}
                </p>
              )}
              {classification.reasoning && !classification.fallback && (
                <p className="text-xs text-gray-500 mt-2">
                  Gemini reasoning: {classification.reasoning}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {!classification ? (
              <button
                onClick={handleClassify}
                disabled={isSubmitting || (!photoFile && !textNote.trim())}
                className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all ${
                  isSubmitting || (!photoFile && !textNote.trim())
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-[#0E5C56] text-white hover:bg-[#0a4a45] shadow-sm'
                }`}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Analyzing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Camera size={18} />
                    Analyze & Classify Issue
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="flex-1 py-3 px-6 bg-[#E85D4C] text-white rounded-lg font-medium hover:bg-[#d54d3c] transition-colors shadow-sm"
              >
                Submit Report
              </button>
            )}
          </div>
        </div>
      </div>

      {showSuccess && (
        <div className="fixed bottom-8 right-8 bg-[#0E5C56] text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up">
          <CheckCircle size={24} />
          <div>
            <p className="font-medium">Report Submitted Successfully</p>
            <p className="text-sm text-green-100">Your complaint has been registered</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="fixed bottom-8 left-8 bg-[#E85D4C] text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up max-w-md">
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
