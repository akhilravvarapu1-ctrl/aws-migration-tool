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
AlertTriangle, Zap, HardDrive, Bell, Network, Cpu, Memory,
Disc, SlidersHorizontal, Settings, Users, Check, X, Code, Map, Globe
} from 'lucide-react';
// --- Global Variables (Mandatory Canvas Environment Variables) ---
// The hosting environment automatically defines __app_id, __firebase_config, and __initial_auth_token.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
// --- Data & Configuration ---
// Rich component palette with migration attributes (migration engineer focused)
const INFRA_COMPONENTS = {
// Key attributes for pre-migration checklist
'onprem-server': { name: 'App Server (VM)', icon: Server, color: 'bg-blue-600', attributes: ['ServerName', 'OS', 'CPU_Cores', 'RAM_GB', 'Storage_Disks', 'IsClusterNode'] },
'onprem-db': { name: 'Database (VM)', icon: Database, color: 'bg-indigo-600', attributes: ['DBEngine', 'DBVersion', 'LicenseType', 'DataSize_GB', 'BackupMethod'] },
'onprem-lb': { name: 'Load Balancer', icon: Zap, color: 'bg-green-600', attributes: ['Model', 'IPAddress', 'ProtocolPorts'] },
'onprem-network': { name: 'Network Gateway', icon: Network, color: 'bg-gray-500', attributes: ['VLAN_ID', 'Subnet_CIDR', 'FirewallRules'] },
// AWS Target Components (Simulated AWS Icons)
'aws-ec2': { name: 'EC2 Instance', icon: Code, color: 'bg-orange-500', attributes: ['InstanceType', 'AMI_ID', 'SecurityGroup_ID', 'TargetSubnet'] },
'aws-rds': { name: 'RDS Instance', icon: Database, color: 'bg-red-500', attributes: ['DBEngine', 'AllocatedStorage_GB', 'MultiAZ_Enabled'] },
'aws-elb': { name: 'ELB (ALB/NLB)', icon: Zap, color: 'bg-teal-500', attributes: ['Type', 'TargetGroup_ARN', 'Listener_Ports'] },
'aws-vpc': { name: 'VPC/Subnet', icon: HardDrive, color: 'bg-sky-500', attributes: ['CIDR_Block', 'AvailabilityZone'] },
};
// Simplified status map for the dashboard
const STATUS_MAP = {
Initiating: { icon: Loader2, color: 'text-yellow-500', label: 'Migration Requested' },
Replicating: { icon: Loader2, color: 'text-blue-500', label: 'Data Replication In Progress' },
'Cutover Pending': { icon: Zap, color: 'text-purple-500', label: 'Ready for Cutover' },
Completed: { icon: CheckCircle, color: 'text-green-500', label: 'Migration Completed' },
Failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Migration Failed' },
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
  return `artifacts/${appId}/users/${userId}/${collectionName}`;
}, [userId]);
// --- FIREBASE INITIALIZATION ---
const initializeFirebase = useCallback(async () => {
  if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
    console.warn("Firebase Config missing or running locally. Data persistence may not work.");
    setIsAuthReady(true);
    // Fallback UUID for local testing when config is missing
    setUserId(crypto.randomUUID());
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
  // Use a small delay to ensure the global variables are fully loaded
  const timer = setTimeout(() => initializeFirebase(), 500);
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
      // Only update if data exists to prevent overwriting local state with nulls
      if (data.appDetails) setAppDetails(data.appDetails);
      if (data.architectureData) setArchitectureData(data.architectureData);
    } else {
      // If document doesn't exist, create it with the initial state
      setDoc(detailsDocRef, { appDetails, architectureData, createdAt: serverTimestamp() }, { merge: true }).catch(e => console.error("Initial doc write error:", e));
    }
  }, (error) => {
    console.error("Error loading app config:", error);
    showNotification(`Failed to load saved configuration: ${error.message}`, 'error');
  });
  return () => unsubscribe();
}, [isAuthReady, db, userId, getCollectionPath]); // Added missing dependencies
// 2. Migration Status Dashboard Listener
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
// --- DATA PERSISTENCE HANDLERS (Manual Save) ---
const saveConfig = useCallback((newAppDetails = appDetails, newArchitectureData = architectureData) => {
  if (!db || !userId || userId.startsWith('error-state')) {
      showNotification("Cannot save: Database connection failed.", 'error');
      return;
  }
  // Path is now guaranteed to be correct due to getCollectionPath
  const detailsDocRef = doc(db, getCollectionPath('app_config'), 'current');
  setDoc(detailsDocRef, { appDetails: newAppDetails, architectureData: newArchitectureData, updatedAt: serverTimestamp() }, { merge: true })
    .then(() => showNotification('Configuration saved!', 'success'))
    .catch(e => {
      console.error("Save error:", e);
      showNotification(`Failed to save configuration: ${e.message}`, 'error');
    });
}, [db, userId, getCollectionPath, appDetails, architectureData, showNotification]);
// --- MIGRATION SIMULATION (Auto-progress status) ---
useEffect(() => {
  if (!db || !userId || !migrations.length || userId.startsWith('error-state')) return;
  const interval = setInterval(() => {
    migrations.forEach(migration => {
      if (migration.status !== 'Completed' && migration.status !== 'Failed') {
        // Cycle through statuses for simulation
        const statuses = ['Initiating', 'Replicating', 'Cutover Pending', 'Completed', 'Failed'];
        const currentIndex = statuses.indexOf(migration.status);
        let newStatus;
        if (currentIndex < 3) { // Initiating, Replicating, Cutover Pending -> advance naturally
            newStatus = statuses[currentIndex + 1];
        } else { // Should only be Cutover Pending which becomes Completed or Failed
            newStatus = Math.random() > 0.85 ? 'Failed' : 'Completed';
        }
        const docRef = doc(db, getCollectionPath('migrations'), migration.id);
        updateDoc(docRef, { status: newStatus, updatedAt: serverTimestamp() }).catch(e => console.error("Sim update error:", e));
      }
    });
  }, 7000); // Slower interval for better viewing
  return () => clearInterval(interval);
}, [db, userId, migrations, getCollectionPath]);
// --- RENDER HELPERS ---
const PageButton = ({ id, label }) => (
<button
    onClick={() => setCurrentPage(id)}
    className={`px-4 py-2 font-semibold transition-colors duration-200 rounded-lg text-sm sm:text-base
      ${currentPage === id ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-600 hover:bg-indigo-100 hover:text-indigo-800'}`
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
    // Pass the current state to saveConfig to ensure latest data is saved
    saveConfig({ ...appDetails });
    setCurrentPage('architecture');
  };
  return (
<div className="max-w-xl mx-auto p-8 bg-white shadow-xl rounded-xl">
<h2 className="text-2xl font-bold text-gray-800 mb-6">1. Setup Migration Scope</h2>
      {/* Application Name */}
<div className="mb-4">
<label className="block text-sm font-medium text-gray-700 mb-1">Application Name (e.g., ERP-Prod)</label>
<input
          type="text"
          value={appDetails.appName}
          onChange={(e) => setAppDetails(prev => ({ ...prev, appName: e.target.value }))}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="Enter application name"
        />
</div>
      {/* Source Environment */}
<div className="mb-4">
<label className="block text-sm font-medium text-gray-700 mb-1">Source Environment</label>
<select
          value={appDetails.sourceEnv}
          onChange={(e) => setAppDetails(prev => ({ ...prev, sourceEnv: e.target.value }))}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
>
<option value="onprem">On-Premises (VMware, Physical)</option>
<option value="aws-to-aws">AWS Region to AWS Region</option>
</select>
<p className="text-xs text-gray-500 mt-1">This selection will customize your component palette.</p>
</div>
      {/* Target AWS Region */}
<div className="mb-6">
<label className="block text-sm font-medium text-gray-700 mb-1">Target AWS Region</label>
<select
          value={appDetails.targetRegion}
          onChange={(e) => setAppDetails(prev => ({ ...prev, targetRegion: e.target.value }))}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
>
<option value="us-east-1">US East (N. Virginia)</option>
<option value="eu-central-1">EU (Frankfurt)</option>
<option value="ap-southeast-2">Asia Pacific (Sydney)</option>
<option value="ap-south-1">Asia Pacific (Mumbai)</option>
</select>
</div>
<button
        onClick={handleNext}
        className="w-full flex items-center justify-center p-3 text-lg font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-md"
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
  // Determine initial phase based on whether source is already confirmed
  const [isSourcePhase, setIsSourcePhase] = useState(architectureData.sourceConfirmed ? false : true);
  // Connection State
  const [connectionStartNodeId, setConnectionStartNodeId] = useState(null);
  // Component Details Modal State
  const [detailModal, setDetailModal] = useState({
      isVisible: false,
      node: null,
      isSource: false
  });
  // Key needed to access the current nodes in state
  const activeSetKey = isSourcePhase ? 'sourceNodes' : 'targetNodes';
  const activeNodes = architectureData[activeSetKey];
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
    // Use the component type ID for dragging payload
    e.dataTransfer.setData('componentType', component.id);
    setDraggingComponent(component);
  };
  const handleDragEnd = (e) => {
      setDraggingComponent(null);
  };
  // --- DROP HANDLER (Adds new node to canvas) ---
  const handleDrop = (e) => {
    e.preventDefault();
    if (!designerRef.current) return;
    // Get the component type from the dataTransfer (more robust than state)
    const componentType = e.dataTransfer.getData('componentType');
    const componentConfig = INFRA_COMPONENTS[componentType];
    if (!componentConfig) return;
    const rect = designerRef.current.getBoundingClientRect();
    // Calculate coordinates relative to the canvas
    const newX = e.clientX - rect.left - 30; // 30px is half component size (60/2)
    const newY = e.clientY - rect.top - 30;
    const newNode = {
      id: architectureData.nextComponentId,
      type: componentType,
      name: `${componentConfig.name}-${architectureData.nextComponentId}`,
      x: Math.max(0, newX), // Ensure within bounds
      y: Math.max(0, newY), // Ensure within bounds
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
  const handleNodeClick = (node) => {
    const allNodes = [...architectureData.sourceNodes, ...architectureData.targetNodes];
    if (connectionStartNodeId === node.id) {
      // Deselect
      setConnectionStartNodeId(null);
      return;
    }
    if (connectionStartNodeId !== null) {
      // Complete connection
      const startNode = allNodes.find(n => n.id === connectionStartNodeId);
      // Ensure both nodes are in the *same* phase (source-source or target-target)
      const startNodeIsSource = architectureData.sourceNodes.some(n => n.id === connectionStartNodeId);
      const targetNodeIsSource = architectureData.sourceNodes.some(n => n.id === node.id);
      if (startNodeIsSource !== targetNodeIsSource) {
          showNotification('Cannot connect Source and Target nodes directly in the designer. Use a transition component if needed.', 'error');
          setConnectionStartNodeId(null);
          return;
      }

      // Prevent connecting to self or creating duplicate connection
      const isDuplicate = architectureData.connections.some(c =>
          (c.sourceId === connectionStartNodeId && c.targetId === node.id)
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
          isSourceConnection: startNodeIsSource, // Connection belongs to source or target diagram
        }]
      }));
      setConnectionStartNodeId(null);
      showNotification('Connection established!', 'info');
    } else {
      // Select start node only if it's in the currently active phase
      const isNodeInActivePhase = activeNodes.some(n => n.id === node.id);
      if (isNodeInActivePhase) {
          setConnectionStartNodeId(node.id);
          showNotification(`Selected ${node.name}. Click another component to connect.`, 'info');
      } else {
          // If node is not in active phase, open details instead
          openDetailModal(node, isSourcePhase);
      }
    }
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
      const isolatedNodes = [];
      // Rule 1: All components must have details filled out (Warning)
      const nodesMissingDetails = nodes.filter(n => !n.isDetailed);
      if (nodesMissingDetails.length > 0) warnings++;
      // Rule 2: Check for isolated components (Error)
      nodes.forEach(node => {
          if (!connections.some(c => c.sourceId === node.id || c.targetId === node.id)) {
              isolatedNodes.push(node.id);
              errors++;
          }
      });
      return { warnings, errors, isComplete: (warnings === 0 && errors === 0), isolatedNodes };
  }
  // Get guidance for the currently active phase
  const currentConnections = architectureData.connections.filter(c => c.isSourceConnection === isSourcePhase);
  const guidance = validateArchitecture(activeNodes, currentConnections);
  // --- RENDERING HELPERS ---
  // Function to calculate node center and draw line
  const renderConnections = () => {
      if (!designerRef.current) return null;
      const nodes = [...architectureData.sourceNodes, ...architectureData.targetNodes];
      return architectureData.connections.map(c => {
          const sourceNode = nodes.find(n => n.id === c.sourceId);
          const targetNode = nodes.find(n => n.id === c.targetId);
          if (!sourceNode || !targetNode) return null;
          // Simple center calculation (60x60 component size)
          const x1 = sourceNode.x + 30;
          const y1 = sourceNode.y + 30;
          const x2 = targetNode.x + 30;
          const y2 = targetNode.y + 30;
          // Highlight connection if one of its nodes is currently selected as start
          const isHighlighted = c.sourceId === connectionStartNodeId || c.targetId === connectionStartNodeId;
          return (
<line
                  key={c.id}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isHighlighted ? "#F59E0B" : "#4F46E5"}
                  strokeWidth={isHighlighted ? "5" : "3"}
                  strokeDasharray={c.isSourceConnection ? "" : "5,5"} // Dashed for Target connections
                  className="transition-all duration-300"
              />
          );
      }).filter(line => line !== null);
  }
  // Function to render a single node
  const NodeComponent = ({ node, isSource }) => {
      const componentConfig = INFRA_COMPONENTS[node.type];
      const ComponentIcon = componentConfig.icon;
      const isSelected = connectionStartNodeId === node.id;
      const isIsolated = guidance.isolatedNodes?.includes(node.id);
      const isMissingDetails = !node.isDetailed;
      let borderColor = 'border-gray-400';
      if (isIsolated) borderColor = 'border-red-500';
      if (isSelected) borderColor = 'border-purple-500 ring-4 ring-purple-300';
      const statusIcon = isMissingDetails ? <AlertTriangle className="w-4 h-4 text-yellow-500" /> : <CheckCircle className="w-4 h-4 text-green-500" />;
      return (
<div
              key={node.id}
              style={{ top: node.y, left: node.x }}
              className={`absolute w-16 h-16 p-2 rounded-xl shadow-lg border-2 flex flex-col items-center justify-center cursor-pointer transition-all duration-150 transform hover:scale-105
                  ${borderColor}
                  ${componentConfig.color}
              `}
              onClick={() => handleNodeClick(node)}
>
<ComponentIcon className="w-6 h-6 text-white" />
<span className="text-white text-xs mt-1 truncate max-w-full font-semibold">{node.name.substring(0, 10)}...</span>
<div className="absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4 p-0.5 bg-white rounded-full">
                  {statusIcon}
</div>
<div className="absolute top-full text-xs mt-1 text-gray-700 w-full text-center pointer-events-none">
                  {node.details.ServerName || node.details.DBEngine || node.name}
</div>
</div>
      );
  }
  return (
<div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[70vh]">
      {/* Left Sidebar - Palette */}
<div className="col-span-12 md:col-span-2 bg-white p-4 rounded-xl shadow-lg">
<h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
<SlidersHorizontal className="w-5 h-5 mr-2 text-indigo-600" />
          Component Palette ({isSourcePhase ? 'Source' : 'Target'})
</h3>
<div className="space-y-3">
          {getComponentPalette().map(c => (
<div
              key={c.id}
              // Add componentType to draggable data for robust drop handling
              draggable
              onDragStart={handleDragStart(c)}
              onDragEnd={handleDragEnd}
              className={`p-3 rounded-lg flex items-center shadow-md cursor-grab transition-all duration-200
                ${c.color} text-white hover:opacity-90`}
>
<c.icon className="w-5 h-5 mr-3" />
<span className="text-sm font-medium">{c.name}</span>
</div>
          ))}
</div>
<button onClick={() => saveConfig()} className="mt-4 w-full p-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
          Manual Save
</button>
</div>
      {/* Main Content Area - Architecture Designer */}
<div className="col-span-12 md:col-span-10">
          {/* Phase Tabs & Confirmation */}
<div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-lg mb-4">
<div className="flex space-x-2">
<button
                      onClick={() => setIsSourcePhase(true)}
                      className={`px-4 py-2 rounded-lg font-bold transition ${isSourcePhase ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
>
                      Source Architecture
</button>
<button
                      onClick={() => setIsSourcePhase(false)}
                      disabled={!architectureData.sourceConfirmed}
                      className={`px-4 py-2 rounded-lg font-bold transition ${!isSourcePhase ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 disabled:opacity-50'}`}
>
                      Target Architecture
</button>
</div>
              {/* Architectural Guidance Indicator */}
<div className="flex items-center space-x-3">
<div className='flex items-center text-sm font-medium'>
                      {guidance.errors > 0
                          ? <span className='text-red-600 flex items-center'><AlertTriangle className='w-4 h-4 mr-1'/> {guidance.errors} Error(s)</span>
                          : guidance.warnings > 0
                          ? <span className='text-yellow-600 flex items-center'><AlertTriangle className='w-4 h-4 mr-1'/> {guidance.warnings} Warning(s)</span>
                          : <span className='text-green-600 flex items-center'><Check className='w-4 h-4 mr-1'/> Architecture OK</span>
                      }
</div>
                  {/* Source Confirmation */}
<button
                      onClick={() => {
                          if (guidance.errors > 0 || guidance.warnings > 0) {
                              showNotification("Please resolve errors (isolated nodes) and warnings (missing details) before confirming.", 'error');
                              return;
                          }
                          // Toggle confirmation status
                          const newState = !architectureData.sourceConfirmed;
                          setArchitectureData(prev => ({ ...prev, sourceConfirmed: newState }));
                          // Save the new state and switch to the Target phase if confirming
                          if (newState) {
                              setIsSourcePhase(false);
                              showNotification(`Source Architecture Confirmed! Now design the Target.`, 'success');
                          } else {
                              showNotification(`Source Architecture Unconfirmed.`, 'warning');
                          }
                          saveConfig(appDetails, { ...architectureData, sourceConfirmed: newState });
                      }}
                      className={`px-3 py-2 text-white font-bold rounded-lg transition-colors ${
                          architectureData.sourceConfirmed ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'
                      }`}
                      disabled={isSourcePhase && (guidance.errors > 0 || activeNodes.length === 0)}
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
              className="relative w-full h-[600px] bg-white border-4 border-dashed border-gray-300 rounded-xl overflow-hidden shadow-inner"
>
<div className="p-4 text-center text-gray-400 italic">
                  {isSourcePhase ? 'Drag components to design the SOURCE Architecture' : `Drag components to design the TARGET AWS Architecture in ${appDetails.targetRegion}`}
</div>
              {/* Connections Layer (SVG) */}
<svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                  {renderConnections()}
</svg>
              {/* Nodes Layer */}
              {/* Render ALL nodes, but only make active phase nodes clickable for connections */}
              {architectureData.sourceNodes.map(node => (
<NodeComponent
                      key={node.id}
                      node={node}
                      isSource={true}
                  />
              ))}
              {architectureData.targetNodes.map(node => (
<NodeComponent
                      key={node.id}
                      node={node}
                      isSource={false}
                  />
              ))}
</div>
          {/* Modal for Component Details/Checklist */}
          {detailModal.isVisible && detailModal.node && (
<ComponentDetailsModal
                  node={detailModal.node}
                  isSource={detailModal.isSource}
                  closeModal={() => setDetailModal({ isVisible: false, node: null, isSource: false })}
                  updateNode={(updatedNode) => {
                      setArchitectureData(prev => {
                          const key = updatedNode.isSource ? 'sourceNodes' : 'targetNodes';
                          const newNodes = prev[key].map(n => n.id === updatedNode.id ? updatedNode : n);
                          // Update the state immediately
                          const newArchitectureData = { ...prev, [key]: newNodes };
                          // Auto-save the updated state to Firestore
                          saveConfig(appDetails, newArchitectureData);
                          return newArchitectureData;
                      });
                      setDetailModal({ isVisible: false, node: null, isSource: false });
                  }}
                  showNotification={showNotification}
              />
          )}
          {/* Kickoff Migration Button */}
          {!isSourcePhase && (
<div className="mt-4 flex justify-end">
<button
                      onClick={() => handleKickoffMigration()}
                      className="flex items-center px-6 py-3 text-lg font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors shadow-xl disabled:opacity-50"
                      disabled={architectureData.targetNodes.length === 0 || guidance.errors > 0}
>
<Zap className="w-5 h-5 mr-2" />
                      Kickoff Migration (AWS MGN Simulation)
</button>
</div>
          )}
</div>
</div>
  );
};
// --- COMPONENT DETAIL MODAL ---
const ComponentDetailsModal = ({ node, isSource, closeModal, updateNode, showNotification }) => {
  // Use node data to determine key: sourceNodes or targetNodes
  const key = isSource ? 'sourceNodes' : 'targetNodes';
  const componentConfig = INFRA_COMPONENTS[node.type];
  const ComponentIcon = componentConfig.icon;
  const [tempDetails, setTempDetails] = useState(node.details || {});
  const [tempName, setTempName] = useState(node.name);
  const handleSave = () => {
      // Simple validation: ensure a name is set
      if (!tempName) {
          showNotification('Please provide a Display Name before saving.', 'warning');
          return;
      }
      // Check if ALL required checklist attributes are filled
      const isDetailed = componentConfig.attributes.every(attr => {
          const value = tempDetails[attr];
          return value !== undefined && value !== null && String(value).trim() !== '';
      });
      const updatedNode = {
          ...node,
          details: tempDetails,
          name: tempName,
          isDetailed: isDetailed, // Set status based on required fields
          isSource: isSource // Pass this back up for correct state updating
      };
      updateNode(updatedNode);
      // Modal is closed in the parent's updateNode handler
      showNotification(`Details for ${tempName} saved. Detailed status: ${isDetailed ? 'Complete' : 'Pending'}`, isDetailed ? 'success' : 'warning');
  };
  return (
<div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
<div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 transform transition-all">
<div className="flex justify-between items-center border-b pb-3 mb-4">
<h3 className="text-xl font-bold text-gray-800 flex items-center">
<ComponentIcon className={`w-6 h-6 mr-2 ${componentConfig.color.replace('bg-', 'text-')}`} />
                      {isSource ? 'Source' : 'Target'} Details: {componentConfig.name}
</h3>
<button onClick={closeModal} className="text-gray-500 hover:text-gray-800"><X /></button>
</div>
<div className="space-y-4 max-h-96 overflow-y-auto pr-3">
                  {/* Component Name */}
<div>
<label className="block text-sm font-semibold text-gray-700 mb-1">Display Name</label>
<input
                          type="text"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-lg"
                      />
</div>
<hr/>
<h4 className="text-lg font-bold text-indigo-600 flex items-center mb-2">
<CheckCircle className='w-4 h-4 mr-2'/> Pre-Migration Checklist Data
</h4>
                  {/* Dynamic Attributes (Checklist) */}
                  {componentConfig.attributes.map(attr => (
<div key={attr}>
<label className="block text-sm font-medium text-gray-700 mb-1">{attr.replace('_', ' ')}</label>
<input
                              type="text"
                              value={tempDetails[attr] || ''}
                              onChange={(e) => setTempDetails(prev => ({ ...prev, [attr]: e.target.value }))}
                              className="w-full p-2 border border-gray-300 rounded-lg"
                              placeholder={`Enter value for ${attr.replace('_', ' ')}...`}
                          />
</div>
                  ))}
<p className="text-xs italic text-gray-500 pt-2">Filling all attributes completes the checklist item for this component.</p>
</div>
<div className="mt-6 flex justify-end space-x-3">
<button onClick={closeModal} className="px-4 py-2 text-gray-600 bg-gray-200 rounded-lg hover:bg-gray-300 font-semibold">
                      Cancel
</button>
<button onClick={handleSave} className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-semibold">
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
  // Filter nodes that are ready to be migrated (detailed and source type)
  const migratableNodes = architectureData.sourceNodes.filter(n => n.isDetailed);
  if (migratableNodes.length === 0) {
      showNotification("No detailed Source Components found to migrate.", 'error');
      return;
  }
  try {
      const migrationCollectionRef = collection(db, getCollectionPath('migrations'));
      for (const node of migratableNodes) {
          // Create a migration record
          await addDoc(migrationCollectionRef, {
              appId: appDetails.appName,
              sourceComponentId: node.id,
              sourceComponentName: node.name,
              sourceDetails: node.details, // Full checklist data stored here
              targetRegion: appDetails.targetRegion,
              // Simplified target naming for simulation
              targetComponentName: `${node.name}-EC2-Target`,
              status: 'Initiating',
              requestedAt: serverTimestamp(),
              mgnJobId: 'MGN-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
          });
      }
      showNotification(`${migratableNodes.length} migration job(s) initiated via MGN (Simulated)!`, 'success');
      setCurrentPage('status');
  } catch (e) {
      console.error("Error initiating migration:", e);
      showNotification(`Error initiating migration: ${e.message}`, 'error');
  }
};
// --- STATUS DASHBOARD PAGE ---
const StatusDashboard = () => (
<div className="p-4 sm:p-8 bg-white shadow-xl rounded-xl">
<h2 className="text-2xl font-bold text-gray-800 mb-6">3. Real-Time Migration Status</h2>
<p className="text-gray-500 mb-4">Monitoring **{appDetails.appName || 'Selected Application'}** to **{appDetails.targetRegion}**.</p>
    {migrations.length === 0 ? (
<div className="text-center p-10 bg-gray-50 rounded-lg text-gray-500">
        No active migration jobs for this user. Complete the design and kickoff a migration from the Architecture tab.
</div>
    ) : (
<div className="space-y-4">
        {migrations.map(migration => {
          const statusInfo = STATUS_MAP[migration.status] || STATUS_MAP['Initiating'];
          const ComponentIcon = statusInfo.icon;
          return (
<div
              key={migration.id}
              className="bg-white p-4 rounded-xl shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between border-l-4 border-indigo-500 transition-shadow hover:shadow-lg"
>
<div className="flex items-start w-full sm:w-1/2 mb-3 sm:mb-0">
<div className={`p-2 rounded-full mr-4 bg-blue-600`}>
<Server className="w-5 h-5 text-white" />
</div>
<div>
<p className="text-lg font-semibold text-gray-800">{migration.sourceComponentName}</p>
<p className="text-sm text-gray-500">
                      {migration.sourceDetails?.ServerName || migration.sourceDetails?.DBEngine || 'VM/Instance'} to {migration.targetComponentName}
</p>
</div>
</div>
<div className="w-full sm:w-1/2 flex items-center justify-start sm:justify-end">
<ComponentIcon
                  className={`w-5 h-5 mr-2 ${statusInfo.color} ${
                    (migration.status === 'Initiating' || migration.status === 'Replicating') ? 'animate-spin' : ''
                  }`}
                />
<span className={`font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                {/* Example Checkpoint 6: Highlight MGN status */}
                {(migration.status === 'Replicating') && (
<span className="ml-4 text-xs font-semibold text-blue-500 bg-blue-100 p-1 rounded">
                        Replication Health: OK
</span>
                )}
                {(migration.status === 'Failed') && (
<span className="ml-4 text-xs font-semibold text-red-500 bg-red-100 p-1 rounded">
                        MGN Error: Check Logs
</span>
                )}
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
<span className="ml-2 text-lg text-gray-700">Initializing Migration Architect...</span>
</div>
  );
}
return (
<div className="min-h-screen bg-gray-50 font-sans p-4 sm:p-8">
<title>AWS Migration Architect</title>
    {/* Header and Navigation */}
<header className="mb-8 bg-white p-4 rounded-xl shadow-lg flex flex-col sm:flex-row justify-between items-center sticky top-0 z-10">
<h1 className="text-xl sm:text-2xl font-extrabold text-gray-800 flex items-center mb-3 sm:mb-0">
<Map className="w-6 h-6 mr-2 text-indigo-600" />
        Migration Architect: <span className="text-indigo-600 ml-2">{appDetails.appName || 'New Project'}</span>
</h1>
<div className="flex space-x-2">
<PageButton id="details" label="1. Scope" />
<PageButton id="architecture" label="2. Design" />
<PageButton id="status" label="3. Status" />
</div>
</header>
    {/* User ID and Notification Toast */}
<div className='mb-4 flex justify-between items-center'>
<p className="text-xs text-gray-400 p-2 bg-gray-200 rounded-lg inline-block">
          **User ID:** <span className="font-mono text-gray-600">{userId || 'N/A'}</span>
</p>
</div>
    {notification.message && (
<div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl flex items-center transition-opacity duration-300 ${
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