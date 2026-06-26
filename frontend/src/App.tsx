*** Begin Patch
*** Update File: frontend/src/App.tsx
@@
-import {
-  LayoutDashboard,
-  Bot,
-  Upload,
-  BarChart3,
-  Menu,
-  X,
-  Bell,
-  Globe,
-  Megaphone,
-  Wifi,
-  WifiOff,
-  ChevronRight,
-  LogOut,
-  Sparkles,
-  Package,
-  FileText,
-} from 'lucide-react';
+import {
+  LayoutDashboard,
+  Bot,
+  Upload,
+  BarChart3,
+  Menu,
+  X,
+  Bell,
+  Globe,
+  Megaphone,
+  Wifi,
+  WifiOff,
+  ChevronRight,
+  LogOut,
+  Sparkles,
+  Package,
+  FileText,
+  Cloud,
+} from 'lucide-react';
@@
-import Analytics from '@/components/Analytics';
+import Analytics from '@/components/Analytics';
+import AwsCostDashboard from '@/components/AwsCostDashboard';
@@
-  { section: 'analytics', label: 'Analytics',        Icon: BarChart3        },
+  { section: 'analytics', label: 'Analytics',        Icon: BarChart3        },
+  { section: 'cloud',     label: 'Cloud Costs',      Icon: Cloud            },
*** End Patch
