import EmailCampaignWidget from '@/components/EmailCampaignWidget';
import LinkedInPostWidget from '@/components/LinkedInPostWidget';
import InstagramPostWidget from '@/components/InstagramPostWidget';
import FacebookPostWidget from '@/components/FacebookPostWidget';

export default function TasksPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          Tasks
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your tasks and automation
        </p>
      </div>

      {/* Task Widgets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Campaign Widget */}
        <EmailCampaignWidget />

        {/* Social Media Widgets */}
        <LinkedInPostWidget />
        <InstagramPostWidget />
        <FacebookPostWidget />

        {/* Future widgets will be added here */}
        {/* Example: <DataSyncWidget /> */}
        {/* Example: <ReportGeneratorWidget /> */}
      </div>
    </div>
  );
}
