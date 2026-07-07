import fs from 'fs';
const files = [
  'src/services/complaintService.ts',
  'src/services/classificationService.ts',
  'src/services/chatService.ts',
  'src/components/OfficerLeadsBoard.tsx',
  'src/components/RoutePlanner.tsx',
  'src/components/TrackMyReports.tsx'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/\$\{import\.meta\.env\.VITE_API_BASE_URL \|\| 'http:\/\/localhost:5173'\}\/api\/([^']+)'/g, "${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/$1`");
  fs.writeFileSync(file, content);
}
console.log('Fixed quotes!');
