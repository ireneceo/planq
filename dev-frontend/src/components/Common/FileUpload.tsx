import React, { useState, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import styled from 'styled-components';

export interface AttachmentFile {
  url: string;
  originalName: string;
  size: number;
  mimeType: string;
}

interface FileUploadProps {
  files: AttachmentFile[];
  onChange: (files: AttachmentFile[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  disabled?: boolean;
  compact?: boolean;
}

const Container = styled.div`margin-top: 8px;`;

const DropZone = styled.div<{ isDragging: boolean; disabled?: boolean }>`
  border: 2px dashed ${props => props.isDragging ? '#6C5CE7' : '#CBD5E1'};
  border-radius: 8px; padding: 16px; text-align: center;
  background: ${props => props.isDragging ? 'rgba(108, 92, 231, 0.05)' : '#F8FAFC'};
  cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
  transition: all 0.2s;
  opacity: ${props => props.disabled ? 0.5 : 1};
  &:hover { border-color: ${props => props.disabled ? '#CBD5E1' : '#6C5CE7'}; }
`;

const DropText = styled.p`font-size: 13px; color: #6B7280; margin: 0 0 4px 0;`;
const DropSubText = styled.p`font-size: 11px; color: #9CA3AF; margin: 0;`;
const HiddenInput = styled.input`display: none;`;
const FileList = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 8px;`;

const FileItem = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #F8F9FA; border-radius: 6px; border: 1px solid #E6EBF1;
`;

const FileIcon = styled.span`font-size: 16px; flex-shrink: 0;`;
const FileInfo = styled.div`flex: 1; min-width: 0;`;
const FileName = styled.div`font-size: 12px; font-weight: 500; color: #0A2540; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const FileSize = styled.div`font-size: 11px; color: #9CA3AF;`;

const RemoveBtn = styled.button`
  background: none; border: none; color: #9CA3AF; cursor: pointer;
  padding: 2px; font-size: 14px; line-height: 1; flex-shrink: 0;
  &:hover { color: #EF4444; }
`;

const UploadingIndicator = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #F0ECFF; border-radius: 6px;
  font-size: 12px; color: #6C5CE7;
`;

const Spinner = styled.div`
  width: 14px; height: 14px; border: 2px solid #E5E7EB; border-top-color: #6C5CE7;
  border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const ALLOWED_EXTENSIONS = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.zip';

const FileUpload: React.FC<FileUploadProps> = ({
  files, onChange, maxFiles = 5, maxSizeMB = 10, disabled = false, compact = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canUpload = !disabled && !uploading && files.length < maxFiles;

  const uploadFiles = async (selectedFiles: FileList) => {
    const remaining = maxFiles - files.length;
    const toUpload = Array.from(selectedFiles).slice(0, remaining);
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      toUpload.forEach(file => formData.append('files', file));
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/upload/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const result = await response.json();
      if (result.success && result.data) onChange([...files, ...result.data]);
    } catch (error) {
      console.error('File upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (index: number) => {
    const file = files[index];
    try {
      const token = localStorage.getItem('auth_token');
      await fetch('/api/upload/file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ url: file.url })
      });
    } catch { /* silent */ }
    onChange(files.filter((_, i) => i !== index));
  };

  const handleDragEnter = (e: DragEvent) => { e.preventDefault(); if (canUpload) setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (canUpload && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <Container>
      {canUpload && (
        <DropZone isDragging={isDragging} disabled={!canUpload}
          onClick={() => canUpload && fileInputRef.current?.click()}
          onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
          onDragOver={handleDragOver} onDrop={handleDrop}>
          {compact
            ? <DropText>Click or drag files to attach ({files.length}/{maxFiles})</DropText>
            : <>
                <DropText>{isDragging ? 'Drop files here' : 'Click or drag files to attach'}</DropText>
                <DropSubText>Images, PDF, DOC, XLS, ZIP (max {maxSizeMB}MB each, {maxFiles - files.length} remaining)</DropSubText>
              </>
          }
        </DropZone>
      )}
      <HiddenInput ref={fileInputRef} type="file" accept={ALLOWED_EXTENSIONS} multiple onChange={handleFileSelect} />
      {(files.length > 0 || uploading) && (
        <FileList>
          {uploading && <UploadingIndicator><Spinner />Uploading...</UploadingIndicator>}
          {files.map((file, idx) => (
            <FileItem key={file.url}>
              <FileIcon>{'\u{1F4CE}'}</FileIcon>
              <FileInfo><FileName>{file.originalName}</FileName><FileSize>{formatFileSize(file.size)}</FileSize></FileInfo>
              {!disabled && <RemoveBtn onClick={() => handleRemove(idx)} title="Remove">&#x2715;</RemoveBtn>}
            </FileItem>
          ))}
        </FileList>
      )}
    </Container>
  );
};

export default FileUpload;
