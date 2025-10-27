import React, { useState, useEffect, useCallback, useRef } from 'react';
// Import Firebase modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import {
getFirestore, collection, onSnapshot, doc,
updateDoc, addDoc, serverTimestamp, setDoc
} from 'firebase/firestore';
// Import all necessary icons from lucide-react (using AWS-style icons for target)
import {
Server, Database, Cloud, ArrowRight, Loader2, CheckCircle,
AlertTriangle, Zap, HardDrive, Bell, Network, Cpu, Settings, Users, Check, X, Code, Map, Globe,
ChevronDown, Trash2
} from 'lucide-react';
// =================================================================
// --- LOCAL DEVELOPMENT PLACEHOLDER DEFINITIONS (CRITICAL FIX) ---
// These satisfy the local linter/compiler. They are overridden by the
// hosting environment's global variables when running in the preview.
const __app_id = 'migration-architect';
const __firebase_config = JSON.stringify({
  apiKey: 'DUMMY_KEY_FOR_LOCAL_LINTER',
  projectId: 'local-dev-project',
});
const __initial_auth_token = null;
// =================================================================
// --- Global Variables (Mandatory Canvas Environment Variables) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
// --- Data & Configuration ---
// Rich component palette with migration attributes (migration engineer focused)
const INFRA_COMPONENTS = {
// Key attributes for pre-migration checklist
'onprem-server': { id: 'onprem-server', name: 'App Server (VM)', icon: Server, color: 'bg-blue-600', attributes: ['ServerName', 'OS', 'CPU_Cores', 'RAM_GB', 'Storage_Disks', 'IsClusterNode'] },
'onprem-db': { id: 'onprem-db', name: 'Database (VM)', icon: Database, color: 'bg-indigo-600', attributes: ['DBEngine', 'DBVersion', 'LicenseType', 'DataSize_GB', 'BackupMethod'] },
'onprem-lb': { id: 'onprem-lb', name: 'Load Balancer', icon: Zap, color: 'bg-green-600', attributes: ['Model', 'IPAddress', 'ProtocolPorts'] },
'onprem-network': { id: 'onprem-network', name: 'Network Gateway', icon: Network, color: 'bg-gray-500', attributes: ['VLAN_ID', 'Subnet_CIDR', 'FirewallRules'] },
// AWS Target Components (Simulated AWS Icons)
'aws-ec2': { id: 'aws-ec2', name: 'EC2 Instance', icon: Cpu, color: 'bg-orange-500', attributes: ['InstanceType', 'AMI_ID', 'SecurityGroup_ID', 'TargetSubnet'] },
'aws-rds': { id: 'aws-rds', name: 'RDS Instance', icon: Database, color: 'bg-red-500', attributes: ['DBEngine', 'AllocatedStorage_GB', 'MultiAZ_Enabled'] },
'aws-elb': { id: 'aws-elb', name: 'ELB (ALB/NLB)', icon: Zap, color: 'bg-teal-500', attributes: ['Type', 'TargetGroup_ARN', 'Listener_Ports'] },
'aws-vpc': { id: 'aws-vpc', name: 'VPC/Subnet', icon: Globe, color: 'bg-sky-500', attributes: ['CIDR_Block', 'AvailabilityZone'] },
};
// Simplified status map for the dashboard
const STATUS_MAP = {
Initiating: { icon: Loader2, color: 'text-yellow-500', label: 'Migration Requested', bg: 'bg-yellow-100' },
Replicating: { icon: Loader2, color: 'text-blue-500', label: 'Data Replication In Progress', bg: 'bg-blue-100' },
'Cutover Pending': { icon: Zap, color: 'text-purple-500', label: 'Ready for Cutover', bg: 'bg-purple-100' },
Completed: { icon: CheckCircle, color: 'text-green-500', label: 'Migration Completed', bg: 'bg-green-100' },
Failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Migration Failed', bg: 'bg-red-100' },
};
// --- CORE APPLICATION COMPONENT ---
const App = () => {
// --- STATE ---
const [db, setDb] = useState(null);
const [userId, setUserId] = useState(null);
const [isAuthReady, setIsAuthReady] = useState(false);
const [currentPage, setCurrentPage] = useState('details'); // details | architecture | status
const [appDetails, setAppDetails] = useState({
  appName: '',
  sourceEnv: 'onprem', // 'onprem' | 'aws-to-aws'
  targetRegion: 'us-east-1',
});
const [migrations, setMigrations] = useState([]); // List of active migrations for StatusDashboard
// State for Architecture Designer (Nodes are components, connections are lines)
const [architectureData, setArchitectureData] = useState({
  sourceNodes: [],
  targetNodes: [],
  connections: [],
  sourceConfirmed: false,
  nextComponentId: 1,
});
const [notification, setNotification] = useState({ message: '', type: '' });
// --- UTILITIES ---
const showNotification = useCallback((message, type = 'info') => {
  setNotification({ message, type });
  setTimeout(() => setNotification({ message: '', type: '' }), 4000);
}, []);
const getCollectionPath = useCallback((collectionName) => {
  if (!userId) return null;
  // Data stored privately: /artifacts/{appId}/users/{userId}/{collectionName}
  return `/artifacts/${appId}/users/${userId}/${collectionName}`;
}, [userId]);
// --- FIREBASE INITIALIZATION (V4 FIX) ---
const initializeFirebase = useCallback(async () => {
  if (!firebaseConfig || Object.keys(firebaseConfig).length === 0 || userId === 'local-dev-app-id') {
    console.warn("Firebase Config missing or running locally. Data persistence may not work.");
    setIsAuthReady(true);
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const userAuth = getAuth(app);
    if (initialAuthToken) {
      await signInWithCustomToken(userAuth, initialAuthToken);
    } else {
      await signInAnonymously(userAuth);
    }
    const currentUserId = userAuth.currentUser?.uid || 'anonymous-fallback';
    setDb(firestore);
    setUserId(currentUserId);
  } catch (error) {
    console.error("Critical Firebase Setup Error:", error);
    setUserId('error-state-' + Date.now());
    showNotification(`Failed to connect to Firebase. Error: ${error.message.substring(0, 50)}...`, 'error');
  } finally {
    setIsAuthReady(true);
  }
}, [showNotification]);
useEffect(() => {
  // Use a minimal delay to ensure global variables are defined
  const timer = setTimeout(() => initializeFirebase(), 100);
  return () => clearTimeout(timer);
}, [initializeFirebase]);
// --- DATA LOADING/LISTENER EFFECTS ---
// 1. Load Application Details and Architecture
useEffect(() => {
  if (!isAuthReady || !db || !userId || userId.startsWith('error-state')) return;
  const detailsDocRef = doc(db, getCollectionPath('app_config'), 'current');
  // Load config (appName, sourceEnv) and architecture data
  const unsubscribe = onSnapshot(detailsDocRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.appDetails) setAppDetails(data.appDetails);
      // Only update architectureData if it's different to prevent resetting drag state
      if (data.architectureData && JSON.stringify(data.architectureData) !== JSON.stringify(architectureData)) {
          setArchitectureData(data.architectureData);
      }
    } else {
      // If no data exists, save the initial state to create the document
      setDoc(detailsDocRef, { appDetails, architectureData, createdAt: serverTimestamp() }, { merge: true }).catch(e => console.error("Initial doc write error:", e));
    }
  }, (error) => {
    console.error("Error loading app config:", error);
    showNotification(`Failed to load saved configuration: ${error.message}`, 'error');
  });
  return () => unsubscribe();
}, [isAuthReady, db, userId, getCollectionPath, showNotification]);
// 2. Migration Status Dashboard Listener (simplified from previous logic)
useEffect(() => {
  if (!isAuthReady || !db || !userId || userId.startsWith('error-state')) return;
  const collectionPath = getCollectionPath('migrations');
  if (!collectionPath) return;
  const migrationCollectionRef = collection(db, collectionPath);
  const unsubscribe = onSnapshot(migrationCollectionRef, (snapshot) => {
    const migrationList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      requestedAtMs: doc.data().requestedAt?.toMillis() || 0,
    }));
    migrationList.sort((a, b) => b.requestedAtMs - a.requestedAtMs);
    setMigrations(migrationList);
  }, (error) => {
    console.error("Error listening to migrations:", error);
  });
  return () => unsubscribe();
}, [isAuthReady, db, userId, getCollectionPath]);
// --- DATA PERSISTENCE HANDLERS ---
const saveConfig = useCallback((newAppDetails = appDetails, newArchitectureData = architectureData) => {
  if (!db || !userId || userId.startsWith('error-state')) {
      showNotification("Cannot save: Database connection failed or user ID not ready.", 'error');
      return;
  }
  const detailsDocRef = doc(db, getCollectionPath('app_config'), 'current');
  setDoc(detailsDocRef, { appDetails: newAppDetails, architectureData: newArchitectureData, updatedAt: serverTimestamp() }, { merge: true })
    .then(() => showNotification('Configuration saved!', 'success'))
    .catch(e => {
      console.error("Save error:", e);
      showNotification(`Failed to save configuration: ${e.message}`, 'error');
    });
}, [db, userId, getCollectionPath, appDetails, architectureData, showNotification]);
// --- MIGRATION SIMULATION (from previous version) ---
useEffect(() => {
  if (!db || !userId || !migrations.length || userId.startsWith('error-state')) return;
  const interval = setInterval(() => {
    migrations.forEach(migration => {
      if (migration.status !== 'Completed' && migration.status !== 'Failed') {
        // Cycle statuses: Initiating -> Replicating (70%) -> Cutover Pending (20%) -> Completed/Failed (10%)
        let newStatus = migration.status;
        switch(migration.status) {
            case 'Initiating':
                newStatus = 'Replicating';
                break;
            case 'Replicating':
                newStatus = Math.random() < 0.7 ? 'Replicating' : 'Cutover Pending';
                break;
            case 'Cutover Pending':
                newStatus = Math.random() < 0.9 ? 'Completed' : 'Failed'; // 90% success rate for cutover
                break;
            default:
                return;
        }
        const docRef = doc(db, getCollectionPath('migrations'), migration.id);
        updateDoc(docRef, { status: newStatus }).catch(e => console.error("Sim update error:", e));
      }
    });
  }, 3000); // Faster update for better simulation visibility
  return () => clearInterval(interval);
}, [db, userId, migrations, getCollectionPath]);
// --- RENDER HELPERS ---
const PageButton = ({ id, label }) => (
<button
        onClick={() => setCurrentPage(id)}
        className={`px-4 py-2 font-semibold transition-colors duration-200 rounded-lg text-sm sm:text-base
          ${currentPage === id ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-indigo-100 hover:text-indigo-800'}`
        }
>
        {label}
</button>
);
// --- PAGE COMPONENTS ---
const AppDetailsPage = () => {
  const handleNext = () => {
    if (!appDetails.appName) {
      showNotification("Please enter an Application Name.", 'warning');
      return;
    }
    saveConfig({ ...appDetails });
    setCurrentPage('architecture');
  };
  return (
<div className="max-w-xl mx-auto p-6 sm:p-8 bg-white shadow-2xl rounded-xl border border-gray-100">
<h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">1. Setup Migration Scope</h2>
          {/* Application Name */}
<div className="mb-6">
<label className="block text-sm font-medium text-gray-700 mb-2">Application Name (e.g., ERP-Prod)</label>
<input
              type="text"
              value={appDetails.appName}
              onChange={(e) => setAppDetails(prev => ({ ...prev, appName: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
              placeholder="Enter application name"
            />
</div>
          {/* Source Environment */}
<div className="mb-6">
<label className="block text-sm font-medium text-gray-700 mb-2">Source Environment</label>
<div className='relative'>
<select
                  value={appDetails.sourceEnv}
                  onChange={(e) => setAppDetails(prev => ({ ...prev, sourceEnv: e.target.value }))}
                  className="block w-full appearance-none p-3 border border-gray-300 rounded-xl bg-white pr-10 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
>
<option value="onprem">On-Premises (VMware, Physical)</option>
<option value="aws-to-aws">AWS Region to AWS Region</option>
</select>
<ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
</div>
<p className="text-xs text-gray-500 mt-1">This selection customizes the initial component palette.</p>
</div>
          {/* Target AWS Region */}
<div className="mb-8">
<label className="block text-sm font-medium text-gray-700 mb-2">Target AWS Region</label>
<div className='relative'>
<select
                  value={appDetails.targetRegion}
                  onChange={(e) => setAppDetails(prev => ({ ...prev, targetRegion: e.target.value }))}
                  className="block w-full appearance-none p-3 border border-gray-300 rounded-xl bg-white pr-10 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
>
<option value="us-east-1">US East (N. Virginia)</option>
<option value="eu-central-1">EU (Frankfurt)</option>
<option value="ap-southeast-2">Asia Pacific (Sydney)</option>
<option value="ap-south-1">Asia Pacific (Mumbai)</option>
</select>
<ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
</div>
</div>
<button
            onClick={handleNext}
            className="w-full flex items-center justify-center p-3 text-lg font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg hover:shadow-xl"
>
<ArrowRight className="w-5 h-5 mr-2" />
            Next: Design Architecture
</button>
</div>
  );
};
// --- ARCHITECTURE PLANNER PAGE (The complex component) ---
const ArchitecturePlanner = () => {
  const designerRef = useRef(null);
  const [draggingComponent, setDraggingComponent] = useState(null);
  const [isSourcePhase, setIsSourcePhase] = useState(architectureData.sourceConfirmed ? false : true);
  // Connection State
  const [connectionStartNodeId, setConnectionStartNodeId] = useState(null);
  // Component Details Modal State
  const [detailModal, setDetailModal] = useState({
      isVisible: false,
      node: null,
      isSource: false
  });
  const activeNodes = isSourcePhase ? architectureData.sourceNodes : architectureData.targetNodes;
  const activeSetKey = isSourcePhase ? 'sourceNodes' : 'targetNodes';
  const getComponentPalette = () => {
    if (isSourcePhase) {
      return appDetails.sourceEnv === 'onprem'
        ? [INFRA_COMPONENTS['onprem-server'], INFRA_COMPONENTS['onprem-db'], INFRA_COMPONENTS['onprem-lb'], INFRA_COMPONENTS['onprem-network']]
        : [INFRA_COMPONENTS['aws-ec2'], INFRA_COMPONENTS['aws-rds'], INFRA_COMPONENTS['aws-elb'], INFRA_COMPONENTS['aws-vpc']];
    }
    // Target is always AWS
    return [INFRA_COMPONENTS['aws-ec2'], INFRA_COMPONENTS['aws-rds'], INFRA_COMPONENTS['aws-elb'], INFRA_COMPONENTS['aws-vpc']];
  };
  // --- DRAG HANDLERS ---
  const handleDragStart = (component) => (e) => {
    setDraggingComponent(component);
    e.dataTransfer.effectAllowed = 'copy';
    // Store component ID for better reliability on drop
    e.dataTransfer.setData('text/plain', component.id);
  };
  const handleDragEnd = (e) => {
      setDraggingComponent(null);
  };
  // --- DROP HANDLER (Adds new node to canvas) ---
  const handleDrop = (e) => {
    e.preventDefault();
    if (!designerRef.current) return;
    const componentId = e.dataTransfer.getData('text/plain');
    const componentConfig = INFRA_COMPONENTS[componentId];
    if (!componentConfig) return;
    const rect = designerRef.current.getBoundingClientRect();
    const newX = e.clientX - rect.left - 30; // 30px is half component size (60/2)
    const newY = e.clientY - rect.top - 30;
    const newNode = {
      id: architectureData.nextComponentId,
      type: componentConfig.id,
      name: `${componentConfig.name}-${architectureData.nextComponentId}`,
      x: newX,
      y: newY,
      details: {}, // Store checklist attributes
      isDetailed: false, // Architectural guidance flag
    };
    setArchitectureData(prev => ({
      ...prev,
      [activeSetKey]: [...prev[activeSetKey], newNode],
      nextComponentId: prev.nextComponentId + 1,
    }));
    // Open detail modal immediately after creation
    setDetailModal({
      isVisible: true,
      node: newNode,
      isSource: isSourcePhase
    });
    setDraggingComponent(null);
  };
  // --- NODE CLICK HANDLER (Connection or Details) ---
  const handleNodeClick = (node, isSource) => {
       if (isSource !== isSourcePhase) {
           showNotification(`Cannot interact with nodes outside the current phase. Switch to ${isSource ? 'Source' : 'Target'} Architecture.`, 'warning');
           return;
       }
       if (connectionStartNodeId === node.id) {
           // Deselect
           setConnectionStartNodeId(null);
           return;
       }
       if (connectionStartNodeId !== null) {
           // Complete connection
           const startNode = activeNodes.find(n => n.id === connectionStartNodeId);
           // Prevent connecting to self or creating duplicate connection
           const isDuplicate = architectureData.connections.some(c =>
               (c.sourceId === connectionStartNodeId && c.targetId === node.id) ||
               (c.sourceId === node.id && c.targetId === connectionStartNodeId)
           );
           if (isDuplicate) {
               showNotification('Connection already exists.', 'warning');
               setConnectionStartNodeId(null);
               return;
           }
           setArchitectureData(prev => ({
             ...prev,
             connections: [...prev.connections, {
               id: crypto.randomUUID(), // Unique ID for keying
               sourceId: connectionStartNodeId,
               targetId: node.id,
               isSourceConnection: isSource, // Connection belongs to source or target diagram
             }]
           }));
           setConnectionStartNodeId(null);
           showNotification('Connection established!', 'success');
       } else {
           // Select start node
           setConnectionStartNodeId(node.id);
           showNotification(`Selected ${node.name}. Click another component to connect.`, 'info');
       }
   };
  // --- DELETE NODE ---
  const handleDeleteNode = (nodeId) => {
      const confirmDelete = window.confirm(`Are you sure you want to delete ${activeNodes.find(n => n.id === nodeId)?.name}?`);
      if (!confirmDelete) return;
      setArchitectureData(prev => {
          // Remove node
          const newNodes = prev[activeSetKey].filter(n => n.id !== nodeId);
          // Remove associated connections
          const newConnections = prev.connections.filter(c => c.sourceId !== nodeId && c.targetId !== nodeId);
          const newState = {
              ...prev,
              [activeSetKey]: newNodes,
              connections: newConnections
          };
          saveConfig(appDetails, newState);
          showNotification('Component and associated connections removed.', 'error');
          return newState;
      });
  };
  // --- OPEN DETAIL MODAL ---
  const openDetailModal = (node, isSource) => {
      // Only open the detail modal if not in connection mode
      if (connectionStartNodeId === null) {
          setDetailModal({
              isVisible: true,
              node: node,
              isSource: isSource
          });
      }
  }
  // --- ARCHITECTURAL GUIDANCE ---
  const validateArchitecture = (nodes, connections) => {
      let warnings = 0;
      let errors = 0;
      let isolatedNodesIds = [];
      // Rule 1: All components must have details filled out
      const nodesMissingDetails = nodes.filter(n => !n.isDetailed);
      if (nodesMissingDetails.length > 0) warnings = nodesMissingDetails.length;
      // Rule 2: Check for isolated components
      const isolatedNodes = nodes.filter(node =>
          !connections.some(c => c.sourceId === node.id || c.targetId === node.id)
      );
      if (isolatedNodes.length > 0) {
          errors = isolatedNodes.length;
          isolatedNodesIds = isolatedNodes.map(n => n.id);
      }
      return { warnings, errors, isolatedNodesIds, isComplete: (warnings === 0 && errors === 0) };
  }
  const sourceGuidance = validateArchitecture(architectureData.sourceNodes, architectureData.connections.filter(c => c.isSourceConnection));
  const targetGuidance = validateArchitecture(architectureData.targetNodes, architectureData.connections.filter(c => !c.isSourceConnection));
  const currentGuidance = isSourcePhase ? sourceGuidance : targetGuidance;

  // --- RENDERING HELPERS ---
  // Function to calculate node center and draw line
  const renderConnections = () => {
      if (!designerRef.current) return null;
      // Filter connections to only show those relevant to the current phase (Source or Target)
      const connectionsToRender = architectureData.connections.filter(c => c.isSourceConnection === isSourcePhase);
      // Nodes only from the active set
      const nodes = activeNodes;
      return connectionsToRender.map(c => {
          const sourceNode = nodes.find(n => n.id === c.sourceId);
          const targetNode = nodes.find(n => n.id === c.targetId);
          if (!sourceNode || !targetNode) return null; // If nodes aren't in the active set, don't draw
          // Simple center calculation (60x60 component size)
          const x1 = sourceNode.x + 30;
          const y1 = sourceNode.y + 30;
          const x2 = targetNode.x + 30;
          const y2 = targetNode.y + 30;
          return (
<line
                  key={c.id}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#4F46E5"
                  strokeWidth="3"
                  strokeDasharray={!isSourcePhase ? "5,5" : ""} // Dashed for Target connections
                  strokeLinecap="round"
                  className="transition-all duration-300"
              />
          );
      }).filter(line => line !== null);
  }
  // Function to render a single node
  const NodeComponent = ({ node, isSource, onClick }) => {
      const componentConfig = INFRA_COMPONENTS[node.type];
      const ComponentIcon = componentConfig.icon;
      const isSelected = connectionStartNodeId === node.id;
      const isIsolated = currentGuidance.isolatedNodesIds.includes(node.id);
      const statusIcon = node.isDetailed ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Settings className="w-4 h-4 text-yellow-500" />;
      return (
<div
           key={node.id}
           style={{ top: node.y, left: node.x }}
           className={`absolute w-16 h-16 p-2 rounded-xl shadow-lg flex flex-col items-center justify-center cursor-pointer transition-all duration-150 transform hover:scale-105 group/node
               ${componentConfig.color}
               ${isSelected ? 'border-4 border-purple-500 ring-4 ring-purple-300 z-20' : 'border-2 border-transparent'}
               ${isIsolated ? 'ring-2 ring-red-500' : ''}
           `}
           onClick={() => handleNodeClick(node, isSource)}
           onDoubleClick={() => openDetailModal(node, isSource)} // Double-click to open details
>
<ComponentIcon className="w-6 h-6 text-white" />
           {/* Status/Detail Indicator */}
<div className="absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4 p-0.5 bg-white rounded-full shadow">
               {statusIcon}
</div>
           {/* Delete Button (Hidden by default, shown on hover/focus) */}
<button
               onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }}
               className="absolute top-0 left-0 transform -translate-x-1/4 -translate-y-1/4 p-0.5 bg-red-600 rounded-full text-white opacity-0 group-hover/node:opacity-100 transition duration-200 shadow-lg"
               title="Delete Component"
>
<Trash2 className="w-3 h-3" />
</button>
           {/* Name Label */}
<div className="absolute top-full text-xs mt-1 text-gray-700 w-full text-center pointer-events-none truncate max-w-[80px]">
               {node.name}
</div>
           {isIsolated && <AlertTriangle className="absolute bottom-1 right-1 text-red-500 w-4 h-4 bg-white rounded-full" />}
</div>
      );
  }
  return (
<div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[70vh]">
       {/* Left Sidebar - Palette (Mobile: full width, Desktop: col-span-2) */}
<div className="col-span-12 md:col-span-2 bg-white p-4 rounded-xl shadow-2xl h-fit sticky top-24">
<h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
<SlidersHorizontal className="w-5 h-5 mr-2 text-indigo-600" />
               Component Palette
</h3>
<p className="text-xs text-gray-500 mb-4">Drag components to the canvas below.</p>
<div className="grid grid-cols-2 gap-3 md:grid-cols-1 md:space-y-3 md:space-y-0">
               {getComponentPalette().map(c => (
<div
                       key={c.id}
                       draggable
                       onDragStart={handleDragStart(c)}
                       onDragEnd={handleDragEnd}
                       className={`p-3 rounded-xl flex flex-col md:flex-row items-center justify-center md:justify-start shadow-xl cursor-grab transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]
                         ${c.color} text-white hover:opacity-95`}
>
<c.icon className="w-6 h-6 mr-0 md:mr-3 mb-1 md:mb-0" />
<span className="text-xs md:text-sm font-semibold text-center">{c.name}</span>
</div>
               ))}
</div>
<button onClick={() => saveConfig()} className="mt-4 w-full p-2 text-sm bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 font-semibold transition">
               Manual Save
</button>
</div>
       {/* Main Content Area - Architecture Designer (Mobile: full width, Desktop: col-span-10) */}
<div className="col-span-12 md:col-span-10">
           {/* Phase Tabs & Confirmation */}
<div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-xl shadow-2xl mb-4 border border-gray-100">
<div className="flex space-x-2 mb-3 sm:mb-0">
<button
                       onClick={() => setIsSourcePhase(true)}
                       className={`px-4 py-2 rounded-xl font-bold transition duration-300 text-sm ${isSourcePhase ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-indigo-50'}`}
>
                       Source Architecture
</button>
<button
                       onClick={() => setIsSourcePhase(false)}
                       disabled={!architectureData.sourceConfirmed}
                       className={`px-4 py-2 rounded-xl font-bold transition duration-300 text-sm ${!isSourcePhase ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-700 disabled:opacity-50 hover:bg-indigo-50'}`}
>
                       Target Architecture
</button>
</div>
               {/* Architectural Guidance Indicator */}
<div className="flex items-center space-x-4">
<div className='flex items-center text-sm font-medium p-2 rounded-lg transition-colors'>
                       {currentGuidance.isComplete
                           ? <span className='text-green-600 flex items-center'><Check className='w-4 h-4 mr-1'/> All Checks OK</span>
                           : <span className='text-red-600 flex items-center'><AlertTriangle className='w-4 h-4 mr-1'/> {currentGuidance.errors > 0 ? `${currentGuidance.errors} Errors` : `${currentGuidance.warnings} Warnings`}</span>}
</div>
                   {/* Source Confirmation Button */}
<button
                       onClick={() => {
                           if (sourceGuidance.errors > 0) {
                               showNotification("Please fix architecture errors (isolated nodes) before confirming.", 'error');
                               return;
                           }
                           const newState = !architectureData.sourceConfirmed;
                           setArchitectureData(prev => ({ ...prev, sourceConfirmed: newState }));
                           showNotification(`Source Architecture ${newState ? 'Confirmed' : 'Unconfirmed'}!`, newState ? 'success' : 'warning');
                           if (newState) setIsSourcePhase(false);
                           saveConfig(appDetails, { ...architectureData, sourceConfirmed: newState });
                       }}
                       className={`px-4 py-2 text-sm text-white font-bold rounded-xl transition-colors shadow-lg ${
                           architectureData.sourceConfirmed ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'
                       }`}
                       disabled={isSourcePhase && sourceGuidance.errors > 0}
>
                       {architectureData.sourceConfirmed ? 'Unconfirm Source' : 'Confirm Source'}
</button>
</div>
</div>
           {/* Architecture Canvas */}
<div
               ref={designerRef}
               onDrop={handleDrop}
               onDragOver={(e) => e.preventDefault()}
               className="relative w-full h-[500px] sm:h-[600px] bg-white border-4 border-dashed border-indigo-200 rounded-xl overflow-hidden shadow-inner"
>
<div className="p-4 text-center text-gray-400 italic bg-indigo-50/50">
                   {isSourcePhase ? 'Design Source Architecture (Drag & Drop Components)' : `Design Target AWS Architecture in ${appDetails.targetRegion}`}
</div>
               {/* Connection Info */}
               {connectionStartNodeId !== null && (
<div className="absolute top-2 left-2 z-30 p-2 bg-purple-500 text-white text-xs rounded-lg shadow-lg animate-pulse">
                       CONNECT MODE: Select Target
</div>
               )}
               {/* Connections Layer (SVG) */}
<svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
                   {renderConnections()}
</svg>
               {/* Nodes Layer */}
<div className='absolute w-full h-full z-20'>
                   {activeNodes.map(node => (
<NodeComponent
                           key={node.id}
                           node={node}
                           isSource={isSourcePhase}
                           onClick={openDetailModal}
                       />
                   ))}
</div>
</div>
           {/* Modal for Component Details/Checklist */}
           {detailModal.isVisible && detailModal.node && (
<ComponentDetailsModal
                   node={detailModal.node}
                   isSource={detailModal.isSource}
                   closeModal={() => setDetailModal({ isVisible: false, node: null, isSource: false })}
                   updateNode={(updatedNode) => {
                       setArchitectureData(prev => {
                           const newNodes = prev[activeSetKey].map(n => n.id === updatedNode.id ? updatedNode : n);
                           const newState = { ...prev, [activeSetKey]: newNodes };
                           saveConfig(appDetails, newState);
                           return newState;
                       });
                   }}
                   showNotification={showNotification}
               />
           )}
           {/* Kickoff Migration Button */}
           {!isSourcePhase && architectureData.sourceConfirmed && (
<div className="mt-6 flex justify-end">
<button
                       onClick={() => handleKickoffMigration()}
                       className="flex items-center px-6 py-3 text-lg font-bold text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors shadow-2xl disabled:opacity-50"
                       disabled={targetGuidance.errors > 0 || architectureData.targetNodes.length === 0}
>
<Zap className="w-5 h-5 mr-2" />
                       Kickoff Migration (AWS MGN Sim)
</button>
</div>
           )}
</div>
</div>
  );
};
// --- COMPONENT DETAIL MODAL ---
const ComponentDetailsModal = ({ node, isSource, closeModal, updateNode, showNotification }) => {
  const componentConfig = INFRA_COMPONENTS[node.type];
  const ComponentIcon = componentConfig.icon;
  const [tempDetails, setTempDetails] = useState(node.details || {});
  const [tempName, setTempName] = useState(node.name);
  const handleSave = () => {
      // Simple validation: ensure ServerName/Engine is set
      const primaryAttrKey = componentConfig.attributes[0]; // Use the first attribute as primary name check
      if (!tempName || !tempDetails[primaryAttrKey]) {
          showNotification(`Please provide a Display Name and value for ${primaryAttrKey.replace('_', ' ')}.`, 'warning');
          return;
      }
      // Check if all required fields are filled to mark as 'detailed'
      const isDetailed = componentConfig.attributes.every(attr => tempDetails[attr] && tempDetails[attr].trim() !== '');
      const updatedNode = {
          ...node,
          details: tempDetails,
          name: tempName,
          isDetailed: isDetailed // Set status based on required fields
      };
      updateNode(updatedNode);
      closeModal();
      showNotification(`Details for ${tempName} saved. Detailed status: ${isDetailed ? 'Complete' : 'Pending'}`, isDetailed ? 'success' : 'info');
  };
  return (
<div className="fixed inset-0 bg-gray-900 bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
<div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 transform transition-all border-t-8 border-indigo-600">
<div className="flex justify-between items-start border-b pb-3 mb-4">
<h3 className="text-xl font-bold text-gray-800 flex items-center">
<ComponentIcon className={`w-6 h-6 mr-2 ${componentConfig.color.replace('bg-', 'text-')}`} />
<span className='font-normal text-sm mr-2'>[{isSource ? 'Source' : 'Target'}]</span> {componentConfig.name}
</h3>
<button onClick={closeModal} className="text-gray-400 hover:text-gray-800 transition"><X /></button>
</div>
<div className="space-y-4 max-h-96 overflow-y-auto pr-3">
               {/* Component Name */}
<div>
<label className="block text-sm font-semibold text-gray-700 mb-1">Display Name</label>
<input
                       type="text"
                       value={tempName}
                       onChange={(e) => setTempName(e.target.value)}
                       className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
                       placeholder="e.g., Web-Server-01"
                   />
</div>
<hr className='my-4'/>
<h4 className="text-lg font-bold text-indigo-600 flex items-center mb-4">
<CheckCircle className='w-4 h-4 mr-2'/> Pre-Migration Checklist Data
</h4>
               {/* Dynamic Attributes (Checklist) */}
               {componentConfig.attributes.map(attr => (
<div key={attr} className="mb-4">
<label className="block text-sm font-medium text-gray-700 mb-1">{attr.replace(/_/g, ' ')} <span className='text-red-500'>*</span></label>
<input
                           type="text"
                           value={tempDetails[attr] || ''}
                           onChange={(e) => setTempDetails(prev => ({ ...prev, [attr]: e.target.value }))}
                           className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
                           placeholder={`Enter value for ${attr.replace(/_/g, ' ')}...`}
                       />
</div>
               ))}
<p className="text-xs italic text-gray-500 pt-2 border-t mt-4">Filling all required fields (<span className='text-red-500'>*</span>) marks this component as detailed and ready for simulation.</p>
</div>
<div className="mt-6 flex justify-end space-x-3 border-t pt-4">
<button onClick={closeModal} className="px-4 py-2 text-gray-600 bg-gray-200 rounded-xl hover:bg-gray-300 font-semibold transition">
                   Cancel
</button>
<button onClick={handleSave} className="px-4 py-2 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 font-semibold transition shadow-md">
                   Save Details
</button>
</div>
</div>
</div>
  );
};
// --- KICKOFF MIGRATION ---
const handleKickoffMigration = async () => {
  if (!architectureData.sourceConfirmed) {
      showNotification("Source architecture must be confirmed before migration kickoff!", 'warning');
      return;
  }
  if (!db || !userId) return;
  // Filter nodes that are part of the migration (e.g., source servers that map to target EC2s)
  const detailedSourceNodes = architectureData.sourceNodes.filter(n => n.isDetailed);
  if (detailedSourceNodes.length === 0) {
      showNotification("No detailed Source Components found to migrate. Fill out component details first.", 'error');
      return;
  }
  try {
      const migrationCollectionRef = collection(db, getCollectionPath('migrations'));
      let jobsInitiated = 0;
      for (const node of detailedSourceNodes) {
          // Simple matching: find any detailed AWS EC2 node to map to
          const targetNode = architectureData.targetNodes.find(t => t.type === 'aws-ec2' && t.isDetailed);
          if (targetNode) {
              // Check if this component is already migrating to prevent duplicates on multiple button clicks
              const isAlreadyMigrating = migrations.some(m => m.sourceComponentId === node.id);
              if (isAlreadyMigrating) continue;
              // Create a migration record
              await addDoc(migrationCollectionRef, {
                  appId: appDetails.appName,
                  sourceComponentId: node.id,
                  sourceComponentName: node.name,
                  sourceDetails: node.details, // Full checklist data stored here
                  targetRegion: appDetails.targetRegion,
                  targetComponentName: targetNode.name,
                  status: 'Initiating',
                  requestedAt: serverTimestamp(),
                  mgnJobId: 'MGN-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
              });
              jobsInitiated++;
          }
      }
      if (jobsInitiated > 0) {
          showNotification(`${jobsInitiated} migration job(s) initiated via MGN!`, 'success');
          setCurrentPage('status');
      } else {
          showNotification("No new, detailed source-to-target mappings found to initiate migration.", 'warning');
      }
  } catch (e) {
      console.error("Error initiating migration:", e);
      showNotification(`Error initiating migration: ${e.message}`, 'error');
  }
};
// --- STATUS DASHBOARD PAGE ---
const StatusDashboard = () => (
<div className="p-4 sm:p-8 bg-white shadow-2xl rounded-xl border border-gray-100">
<h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">3. Real-Time Migration Status</h2>
<p className="text-gray-500 mb-6">Monitoring **{appDetails.appName || 'Selected Application'}** to **{appDetails.targetRegion}**.</p>
        {migrations.length === 0 ? (
<div className="text-center p-12 bg-indigo-50 rounded-xl border-2 border-dashed border-indigo-200 text-gray-600">
<Cloud className='w-10 h-10 mx-auto text-indigo-400 mb-3' />
<p className='font-semibold'>No active migration jobs.</p>
<p className='text-sm mt-1'>Please complete the Architecture Design and Kickoff a migration to see status here.</p>
</div>
        ) : (
<div className="space-y-4">
                {/* Migration Card Header for Desktop */}
<div className="hidden sm:grid grid-cols-12 gap-4 text-xs font-bold uppercase text-gray-500 pb-2 border-b">
<div className='col-span-4'>Source Component</div>
<div className='col-span-3'>Target / Job ID</div>
<div className='col-span-3'>Status</div>
<div className='col-span-2 text-right'>Requested</div>
</div>
               {migrations.map(migration => {
                  const statusInfo = STATUS_MAP[migration.status] || STATUS_MAP['Initiating'];
                  const ComponentIcon = statusInfo.icon;
                  return (
<div
                       key={migration.id}
                       className={`bg-white p-4 rounded-xl shadow-lg flex flex-col sm:grid sm:grid-cols-12 gap-4 items-center transition-shadow hover:shadow-xl border-l-4 border-indigo-500 ${statusInfo.bg}`}
>
                       {/* Source Component */}
<div className="col-span-4 flex items-center w-full">
<div className={`p-2 rounded-full mr-3 bg-blue-600 flex-shrink-0`}>
<Server className="w-5 h-5 text-white" />
</div>
<div className='truncate'>
<p className="text-sm font-semibold text-gray-800 truncate">{migration.sourceComponentName}</p>
<p className="text-xs text-gray-500 truncate">{migration.sourceDetails?.OS || migration.sourceDetails?.DBEngine || 'VM/Instance'}</p>
</div>
</div>
                       {/* Target / Job ID */}
<div className="col-span-3 w-full">
<p className="text-xs font-medium text-gray-600 sm:hidden">Target / Job ID:</p>
<p className="text-sm font-medium text-indigo-700">{migration.targetComponentName}</p>
<p className="text-xs text-gray-500 font-mono">{migration.mgnJobId}</p>
</div>
                       {/* Status */}
<div className="col-span-3 w-full flex items-center justify-start">
<ComponentIcon
                               className={`w-5 h-5 mr-2 ${statusInfo.color} ${
                                 (migration.status === 'Initiating' || migration.status === 'Replicating') ? 'animate-spin' : ''
                               }`}
                             />
<span className={`font-bold text-sm ${statusInfo.color}`}>{statusInfo.label}</span>
</div>
                       {/* Requested At */}
<div className="col-span-2 w-full text-left sm:text-right">
<p className="text-xs font-medium text-gray-600 sm:hidden">Requested:</p>
<p className="text-sm text-gray-500">{new Date(migration.requestedAtMs).toLocaleDateString()}</p>
<p className="text-xs text-gray-400">{new Date(migration.requestedAtMs).toLocaleTimeString()}</p>
</div>
</div>
                  );
                })}
</div>
        )}
</div>
);
// --- Main App Renderer ---
if (!isAuthReady) {
  return (
<div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
<Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
<span className="ml-3 text-xl text-gray-700 font-semibold">Initializing Migration Architect...</span>
</div>
  );
}
return (
<div className="min-h-screen bg-gray-50 font-['Inter'] p-4 sm:p-8">
<title>AWS Migration Architect</title>
        {/* Header and Navigation */}
<header className="mb-8 bg-white p-4 rounded-xl shadow-xl flex flex-col sm:flex-row justify-between items-center sticky top-0 z-40 border-t-4 border-indigo-600">
<h1 className="text-2xl font-extrabold text-gray-800 flex items-center mb-3 sm:mb-0">
<Map className="w-6 h-6 mr-2 text-indigo-600" />
                Migration Architect: <span className="text-indigo-600 ml-1 truncate max-w-[200px]">{appDetails.appName || 'New Project'}</span>
</h1>
<div className="flex space-x-2 w-full justify-center sm:w-auto">
<PageButton id="details" label="1. Scope Setup" />
<PageButton id="architecture" label="2. Architecture Design" />
<PageButton id="status" label="3. Migration Status" />
</div>
</header>
        {/* User ID and Notification Toast */}
<div className='mb-4 flex justify-between items-center'>
<p className="text-xs text-gray-400 p-2 bg-gray-200 rounded-lg inline-block shadow-inner">
               **User ID:** <span className="font-mono text-gray-600">{userId || 'N/A'}</span>
</p>
           {/* Connection Status Icon */}
<div className={`p-2 rounded-full ${db ? 'bg-green-500' : 'bg-red-500'}`} title={db ? 'Firebase Connected' : 'Firebase Disconnected'}>
<Globe className='w-4 h-4 text-white'/>
</div>
</div>
        {notification.message && (
<div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-2xl flex items-center transition-opacity duration-300 ${
                notification.type === 'success' ? 'bg-green-500 text-white' :
                notification.type === 'warning' ? 'bg-yellow-500 text-gray-800' :
                'bg-red-500 text-white'
              }`}>
<Bell size={20} className="mr-2" />
<p className="font-semibold">{notification.message}</p>
</div>
        )}
        {/* Page Content */}
<main className="mt-8">
              {currentPage === 'details' && <AppDetailsPage />}
              {currentPage === 'architecture' && <ArchitecturePlanner />}
              {currentPage === 'status' && <StatusDashboard />}
</main>
</div>
);
};
export default App;