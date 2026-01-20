const firebaseConfig = {
    apiKey: "AIzaSyCXu-123456789abc",
    authDomain: "feedferry-app.firebaseapp.com",
    databaseURL: "https://feedferry-app.firebaseio.com",
    projectId: "feedferry-app",
    storageBucket: "feedferry-app.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123def456"
};

let firebaseApp, database, ref;

try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    database = firebase.database();
} catch(e) {
    console.log("Firebase not configured with real credentials. Using local storage for demo.");
}

let currentUser = null;
let allDonations = [];
let allUsers = [];
let allMessages = [];
let allNGOs = [];
let currentChatUserId = null;
let conversationHistory = {};
let trackingMaps = {};
let originalNavLinksHtml = null;
let filteredListings = [];

// Minimal location dataset (scalable: you can expand this list over time or load from a JSON file later)
const LOCATION_DATA = {
    'Maharashtra': {
        'Mumbai': ['Mumbai'],
        'Pune': ['Pune'],
        'Thane': ['Thane'],
        'Nagpur': ['Nagpur']
    },
    'Delhi': {
        'New Delhi': ['New Delhi']
    },
    'Karnataka': {
        'Bengaluru Urban': ['Bangalore']
    },
    'Telangana': {
        'Hyderabad': ['Hyderabad']
    },
    'Tamil Nadu': {
        'Chennai': ['Chennai']
    },
    'West Bengal': {
        'Kolkata': ['Kolkata']
    }
};

function uniqSorted(arr) {
    return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(selectEl, options, placeholder) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    if (placeholder) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
    }
    options.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        selectEl.appendChild(opt);
    });
    // keep value if still exists
    if (current && options.includes(current)) selectEl.value = current;
}

function initLocationDropdowns() {
    // Post form dropdowns
    setSelectOptions(document.getElementById('pickupState'), uniqSorted(Object.keys(LOCATION_DATA)), 'State');
    onPickupStateChange();

    // Listings filters dropdowns
    setSelectOptions(document.getElementById('filterState'), uniqSorted(Object.keys(LOCATION_DATA)), 'All States');
    applyListingsFilters();
}

function onPickupStateChange() {
    const stateEl = document.getElementById('pickupState');
    const districtEl = document.getElementById('pickupDistrict');
    const cityEl = document.getElementById('pickupCity');
    const state = stateEl ? stateEl.value : '';

    if (!state || !LOCATION_DATA[state]) {
        setSelectOptions(districtEl, [], 'District');
        setSelectOptions(cityEl, [], 'City');
        return;
    }

    const districts = uniqSorted(Object.keys(LOCATION_DATA[state]));
    setSelectOptions(districtEl, districts, 'District');
    onPickupDistrictChange();
}

function onPickupDistrictChange() {
    const state = (document.getElementById('pickupState') || {}).value || '';
    const district = (document.getElementById('pickupDistrict') || {}).value || '';
    const cityEl = document.getElementById('pickupCity');
    if (!state || !district || !LOCATION_DATA[state] || !LOCATION_DATA[state][district]) {
        setSelectOptions(cityEl, [], 'City');
        return;
    }
    const cities = uniqSorted(LOCATION_DATA[state][district]);
    setSelectOptions(cityEl, cities, 'City');
}

function onFilterStateChange() {
    const stateEl = document.getElementById('filterState');
    const districtEl = document.getElementById('filterDistrict');
    const cityEl = document.getElementById('filterCity');
    const state = stateEl ? stateEl.value : '';
    if (!state || !LOCATION_DATA[state]) {
        setSelectOptions(districtEl, [], 'All Districts');
        setSelectOptions(cityEl, [], 'All Cities');
        return;
    }
    setSelectOptions(districtEl, uniqSorted(Object.keys(LOCATION_DATA[state])), 'All Districts');
    onFilterDistrictChange();
}

function onFilterDistrictChange() {
    const state = (document.getElementById('filterState') || {}).value || '';
    const district = (document.getElementById('filterDistrict') || {}).value || '';
    const cityEl = document.getElementById('filterCity');
    if (!state || !district || !LOCATION_DATA[state] || !LOCATION_DATA[state][district]) {
        setSelectOptions(cityEl, [], 'All Cities');
        return;
    }
    setSelectOptions(cityEl, uniqSorted(LOCATION_DATA[state][district]), 'All Cities');
}

function applyListingsFilters() {
    onFilterStateChange();
    const state = (document.getElementById('filterState') || {}).value || '';
    const district = (document.getElementById('filterDistrict') || {}).value || '';
    const city = (document.getElementById('filterCity') || {}).value || '';

    const base = allDonations.filter(d => d.status === 'pending'); // current demo status
    let list = base;
    if (state) list = list.filter(d => d.pickup && d.pickup.state === state);
    if (district) list = list.filter(d => d.pickup && d.pickup.district === district);
    if (city) list = list.filter(d => d.pickup && d.pickup.city === city);

    // Nearby-first: match current user's city first (fallback to donation.donorLocation)
    const myCity = currentUser ? (currentUser.location || '') : '';
    list.sort((a, b) => {
        const aCity = (a.pickup && a.pickup.city) || a.donorLocation || '';
        const bCity = (b.pickup && b.pickup.city) || b.donorLocation || '';
        const aScore = aCity === myCity ? 1 : 0;
        const bScore = bCity === myCity ? 1 : 0;
        if (aScore !== bScore) return bScore - aScore;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    filteredListings = list;
    renderListingsFromFiltered();
}

function renderListingsFromFiltered() {
    const list = filteredListings.length ? filteredListings : allDonations.filter(d => d.status === 'pending');
    const html = list
        .filter(d => !currentUser || currentUser.role !== 'ngo' || d.status === 'pending')
        .map(d => `
            <div class="list-item">
                <div class="list-item-header">
                    <div>
                        <div class="list-item-title">${d.foodName || d.foodCategory || 'Food'} - ${d.quantity} ${d.unit || 'kg'}</div>
                        <div class="list-item-meta">
                            By: ${d.donorName}
                            ${d.pickup && d.pickup.city ? ` | 📍 ${d.pickup.city}, ${d.pickup.district || ''}` : ''}
                            ${d.expiryAt ? ` | Expires: ${new Date(d.expiryAt).toLocaleString()}` : ''}
                        </div>
                    </div>
                    ${currentUser && currentUser.role === 'ngo' ? `<button class="btn-action" onclick="acceptDonation('${d.id}')">Accept</button>` : ''}
                </div>
                <p>${d.description || ''}</p>
            </div>
        `).join('');
    const target = document.getElementById('listingsList');
    if (target) target.innerHTML = html || '<p>No donations found for selected filters.</p>';
}

function toggleMobileNav() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    navbar.classList.toggle('nav-open');
}

function openLoginModal() { document.getElementById('loginModal').classList.add('show'); }
function closeLoginModal() { document.getElementById('loginModal').classList.remove('show'); }
function openRegisterModal() { document.getElementById('registerModal').classList.add('show'); }
function closeRegisterModal() { document.getElementById('registerModal').classList.remove('show'); }
function openPostFoodModal() { document.getElementById('postFoodModal').classList.add('show'); }
function closePostFoodModal() { document.getElementById('postFoodModal').classList.remove('show'); }

function renderNavbarLinks() {
    const navList = document.querySelector('.nav-links');
    if (!navList) return;
    if (originalNavLinksHtml === null) originalNavLinksHtml = navList.innerHTML;

    // Public site
    if (!currentUser) {
        navList.innerHTML = originalNavLinksHtml;
        return;
    }

    // Dashboard links (use buttons, not anchors to hidden sections)
    const links = [
        { label: 'Overview', tab: 'overview' },
        { label: 'Messages', tab: 'chat' },
        { label: 'Track', tab: 'tracking' }
    ];
    if (currentUser.role === 'donor') links.splice(1, 0, { label: 'Post Food', tab: 'donations' });
    if (currentUser.role === 'ngo') links.splice(1, 0, { label: 'Available Food', tab: 'listings' });
    // Keep discovery for everyone (for chat)
    links.push({ label: 'NGOs', tab: 'ngos' });
    links.push({ label: 'Donors', tab: 'donors' });

    navList.innerHTML = links
        .map(l => `<li><a href="#" onclick="goToDashboardTab('${l.tab}'); return false;">${l.label}</a></li>`)
        .join('');
}

function goToDashboardTab(tab) {
    // Ensure dashboard is visible
    if (!currentUser) return;
    if (document.getElementById('dashboardSection').style.display !== 'block') {
        showDashboard();
    }
    activateTab(tab);
    document.getElementById('dashboardSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const user = allUsers.find(u => u.email === email && u.password === password);
    if (user) {
        currentUser = user;
        localStorage.setItem('currentUser', JSON.stringify(user));
        closeLoginModal();
        showDashboard();
        loadDashboardData();
        alert('Login successful! Welcome ' + user.name);
    } else {
        alert('Invalid email or password');
    }
}

function handleRegister(e) {
    e.preventDefault();
    const newUser = {
        id: Math.random().toString(36).substr(2, 9),
        name: document.getElementById('userName').value,
        email: document.getElementById('userEmail').value,
        password: document.getElementById('userPassword').value,
        role: document.getElementById('userRole').value,
        location: document.getElementById('userLocation').value,
        createdAt: new Date().toISOString()
    };

    if (allUsers.some(u => u.email === newUser.email)) {
        alert('Email already registered!');
        return;
    }

    allUsers.push(newUser);
    saveToStorage('users', allUsers);

    if (database) {
        database.ref('users/' + newUser.id).set(newUser);
    }

    currentUser = newUser;
    localStorage.setItem('currentUser', JSON.stringify(newUser));
    closeRegisterModal();
    showDashboard();
    loadDashboardData();
    alert('Registration successful! Welcome to Feed Ferry');
}

function logout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    hideDashboard();
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
}

function showDashboard() {
    document.querySelector('.hero').style.display = 'none';
    document.querySelectorAll('.problem-section, .about-section, .how-it-works, .features-section, .impact-section, .track-order-section, .cta-section, .contact-section, .footer').forEach(el => el.style.display = 'none');
    document.getElementById('dashboardSection').style.display = 'block';
    document.getElementById('btnLogin').style.display = 'none';
    document.getElementById('btnRegister').style.display = 'none';
    document.getElementById('btnLogout').style.display = 'inline-block';
    document.getElementById('userInfo').style.display = 'inline-block';
    document.getElementById('userInfo').textContent = `Welcome, ${currentUser.name} (${currentUser.role})`;

    if (currentUser.role === 'donor') {
        document.getElementById('btnDonations').style.display = 'block';
    }
    if (currentUser.role === 'ngo') {
        document.getElementById('btnListings').style.display = 'block';
    }
    
    // Let everyone discover and chat with donors/NGOs (donor ↔ NGO, donor ↔ donor, NGO ↔ NGO if desired)
    document.getElementById('btnNGOs').style.display = 'block';
    document.getElementById('btnDonors').style.display = 'block';

    document.getElementById('btnTracking').style.display = 'block';
    renderNavbarLinks();
}

function hideDashboard() {
    document.querySelector('.hero').style.display = 'block';
    document.querySelectorAll('.problem-section, .about-section, .how-it-works, .features-section, .impact-section, .track-order-section, .cta-section, .contact-section, .footer').forEach(el => el.style.display = 'block');
    document.getElementById('dashboardSection').style.display = 'none';
    
    setTimeout(() => {
        if (!publicTrackMap) {
            initializeDefaultTrackMap();
        }
    }, 300);
    document.getElementById('btnLogin').style.display = 'inline-block';
    document.getElementById('btnRegister').style.display = 'inline-block';
    document.getElementById('btnLogout').style.display = 'none';
    document.getElementById('userInfo').style.display = 'none';

    // Restore public navbar
    renderNavbarLinks();
}

function activateTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tab).classList.add('active');
    const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => (b.getAttribute('onclick') || '').includes(`'${tab}'`));
    if (btn) btn.classList.add('active');

    if (tab === 'listings') loadNGOListings();
    if (tab === 'ngos') loadNGOsList();
    if (tab === 'donors') loadDonorsList();
    if (tab === 'chat') loadConversations();
    if (tab === 'tracking') loadTracking();
}

function switchTab(tab, e) {
    activateTab(tab);
    if (e && e.target) e.target.closest('.nav-btn').classList.add('active');
}

function handlePostFood(e) {
    e.preventDefault();
    
    const errorEl = document.getElementById('postFoodError');
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    const name = document.getElementById('foodName').value.trim();
    const category = document.getElementById('foodCategory').value;
    const vegType = document.getElementById('foodVegType').value;
    const quantity = parseFloat(document.getElementById('foodQuantity').value);
    const unit = document.getElementById('foodQuantityUnit').value;
    const expiryRaw = document.getElementById('foodExpiry').value;
    const state = document.getElementById('pickupState').value.trim();
    const district = document.getElementById('pickupDistrict').value.trim();
    const city = document.getElementById('pickupCity').value.trim();
    const addressLine = document.getElementById('pickupAddressLine').value.trim();
    const description = document.getElementById('foodDescription').value.trim();

    const errors = [];
    if (!name) errors.push('Food name is required.');
    if (!category) errors.push('Food category is required.');
    if (!vegType) errors.push('Please specify if the food is veg or non-veg.');
    if (!(quantity > 0)) errors.push('Quantity must be greater than 0.');
    if (!unit) errors.push('Quantity unit is required.');
    if (!expiryRaw) {
        errors.push('Expiry date and time is required.');
    } else {
        const expiryDate = new Date(expiryRaw);
        const now = new Date();
        const minValid = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes buffer
        if (isNaN(expiryDate.getTime()) || expiryDate <= now) {
            errors.push('Expiry must be in the future.');
        } else if (expiryDate < minValid) {
            errors.push('Expiry should be at least 30 minutes from now so NGOs can collect in time.');
        }
    }
    if (!state || !district || !city) errors.push('State, district and city are required.');
    if (!addressLine) errors.push('Full pickup address is required.');

    if (errors.length) {
        const msg = errors.join(' ');
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        } else {
            alert(msg);
        }
        return;
    }

    const expiryAt = new Date(expiryRaw).toISOString();
    const createdAt = new Date().toISOString();

    const donation = {
        id: Math.random().toString(36).substr(2, 9),
        donorId: currentUser.id,
        donorName: currentUser.name,
        donorLocation: currentUser.location,
        foodName: name,
        foodCategory: category,
        vegType: vegType,
        quantity: quantity,
        unit: unit,
        expiryAt: expiryAt,
        pickup: {
            state,
            district,
            city,
            addressLine
        },
        description: description,
        status: 'pending',
        createdAt,
        statusHistory: [
            {
                status: 'pending',
                at: createdAt
            }
        ]
    };

    allDonations.push(donation);
    saveToStorage('donations', allDonations);

    if (database) {
        database.ref('donations/' + donation.id).set(donation);
    }

    closePostFoodModal();
    loadDashboardData();
    alert('Food donation posted successfully!');
    e.target.reset();
}

function loadNGOListings() {
    applyListingsFilters();
}

function acceptDonation(donationId) {
    const donation = allDonations.find(d => d.id === donationId);
    if (donation) {
        donation.status = 'accepted';
        donation.acceptedBy = currentUser.id;
        donation.acceptedAt = new Date().toISOString();
        if (!Array.isArray(donation.statusHistory)) donation.statusHistory = [];
        donation.statusHistory.push({ status: 'accepted', at: donation.acceptedAt });
        saveToStorage('donations', allDonations);
        if (database) {
            database.ref('donations/' + donationId).update(donation);
        }
        alert('Donation accepted! Please collect it.');
        loadNGOListings();
        loadDashboardData();
    }
}

function loadNGOsList() {
    const ngos = allUsers.filter(u => u.role === 'ngo');
    const html = ngos.map(ngo => `
        <div class="list-item">
            <div class="list-item-header">
                <div>
                    <div class="list-item-title">${ngo.name}</div>
                    <div class="list-item-meta">📍 ${ngo.location}</div>
                </div>
                <button class="btn-action" onclick="startChat('${ngo.id}', '${ngo.name}')">Chat</button>
            </div>
        </div>
    `).join('');

    document.getElementById('ngosList').innerHTML = html || '<p>No NGOs available.</p>';
}

function loadDonorsList() {
    const donors = allUsers.filter(u => u.role === 'donor' && (!currentUser || u.id !== currentUser.id));
    const html = donors.map(donor => {
        const donorDonations = allDonations.filter(d => d.donorId === donor.id && d.status === 'pending');
        return `
            <div class="list-item">
                <div class="list-item-header">
                    <div>
                        <div class="list-item-title">${donor.name}</div>
                        <div class="list-item-meta">📍 ${donor.location} | ${donorDonations.length} donations</div>
                    </div>
                    <button class="btn-action" onclick="startChat('${donor.id}', '${donor.name}')">Chat</button>
                </div>
                <div style="margin-top: 0.5rem; font-size: 0.9rem;">
                    ${donorDonations.map(d => `<span style="display: inline-block; background: var(--primary); color: white; padding: 0.2rem 0.5rem; border-radius: 3px; margin-right: 0.3rem;">${(d.foodName || d.foodCategory || 'Food')}: ${d.quantity}${d.unit ? ' ' + d.unit : 'kg'}</span>`).join('')}
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('donorsList').innerHTML = html || '<p>No donors available.</p>';
}

function getConversationKey(userId) {
    const ids = [currentUser.id, userId].sort();
    return ids.join('_');
}

function startChat(userId, userName) {
    currentChatUserId = userId;
    document.getElementById('chatHeader').textContent = '💬 Chat with ' + userName;
    displayChatMessages();
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!currentChatUserId) {
        alert('Please select a conversation first');
        return;
    }

    if (message && currentUser) {
        const conversationKey = getConversationKey(currentChatUserId);
        const chatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            conversationKey: conversationKey,
            senderId: currentUser.id,
            senderName: currentUser.name,
            receiverId: currentChatUserId,
            message: message,
            timestamp: new Date().toISOString()
        };

        allMessages.push(chatMessage);
        saveToStorage('messages', allMessages);

        if (database) {
            database.ref('messages/' + chatMessage.id).set(chatMessage);
        }

        messageInput.value = '';
        displayChatMessages();
        loadConversations();
    }
}

function displayChatMessages() {
    if (!currentChatUserId) {
        document.getElementById('chatMessages').innerHTML = '<p style="padding: 1rem; text-align: center; color: var(--text);">Select a conversation to view messages</p>';
        return;
    }

    const conversationKey = getConversationKey(currentChatUserId);
    const messages = allMessages
        .filter(m => m.conversationKey === conversationKey)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const html = messages
        .map(msg => `
            <div class="chat-message ${msg.senderId === currentUser.id ? 'sent' : 'received'}">
                <strong>${msg.senderName}:</strong> ${msg.message}
                <div style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.2rem;">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            </div>
        `).join('');

    const chatContainer = document.getElementById('chatMessages');
    chatContainer.innerHTML = html || '<p style="padding: 1rem; text-align: center; color: var(--text);">No messages yet. Start the conversation!</p>';
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function loadConversations() {
    const myConversations = new Set();
    
    allMessages.forEach(msg => {
        if (msg.senderId === currentUser.id || msg.receiverId === currentUser.id) {
            const otherId = msg.senderId === currentUser.id ? msg.receiverId : msg.senderId;
            myConversations.add(otherId);
        }
    });

    const html = Array.from(myConversations).map(userId => {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return '';
        const lastMessage = allMessages
            .filter(m => m.conversationKey === getConversationKey(userId))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
        
        return `
            <div style="padding: 0.8rem; background: ${currentChatUserId === userId ? 'var(--primary)' : 'white'}; color: ${currentChatUserId === userId ? 'white' : 'black'}; cursor: pointer; border-radius: 5px; margin-bottom: 0.5rem; border-left: 3px solid var(--primary); transition: all 0.3s;" onclick="startChat('${userId}', '${user.name}'); loadConversations();">
                <div style="font-weight: 600;">${user.name}</div>
                <div style="font-size: 0.85rem; opacity: 0.8;">${lastMessage ? lastMessage.message.substring(0, 30) + '...' : 'No messages'}</div>
            </div>
        `;
    }).join('');

    document.getElementById('conversationList').innerHTML = html || '<p style="padding: 1rem; font-size: 0.9rem; color: var(--text); text-align: center;">No conversations yet</p>';
}

function refreshMessagesFromStorage() {
    const latest = loadFromStorage('messages');
    // Basic guard: only update if length differs to avoid re-render spam
    if (!Array.isArray(latest)) return;
    if (latest.length !== allMessages.length) {
        allMessages = latest;
        // If user is on chat tab, refresh UI
        const chatTab = document.getElementById('chat');
        if (chatTab && chatTab.classList.contains('active')) {
            loadConversations();
            displayChatMessages();
        }
    }
}

function getCityCoordinates(cityName) {
    const cityMap = {
        'Mumbai': [19.0760, 72.8777],
        'Delhi': [28.6139, 77.2090],
        'Bangalore': [12.9716, 77.5946],
        'Hyderabad': [17.3850, 78.4867],
        'Chennai': [13.0827, 80.2707],
        'Kolkata': [22.5726, 88.3639],
        'Pune': [18.5204, 73.8567],
        'Ahmedabad': [23.0225, 72.5714],
        'Jaipur': [26.9124, 75.7873],
        'Surat': [21.1702, 72.8311]
    };
    return cityMap[cityName] || [19.0760, 72.8777];
}

function initializeTrackingMap(donationId, donorLocation, ngoLocation, status) {
    if (trackingMaps[donationId]) {
        trackingMaps[donationId].remove();
        delete trackingMaps[donationId];
    }
    
    const mapContainer = document.getElementById(`map-${donationId}`);
    if (!mapContainer) return;
    
    const donorCoords = getCityCoordinates(donorLocation);
    const ngoCoords = ngoLocation ? getCityCoordinates(ngoLocation) : null;
    
    let centerLat = donorCoords[0];
    let centerLng = donorCoords[1];
    
    if (ngoCoords) {
        centerLat = (donorCoords[0] + ngoCoords[0]) / 2;
        centerLng = (donorCoords[1] + ngoCoords[1]) / 2;
    }
    
    const map = L.map(`map-${donationId}`, {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView([centerLat, centerLng], ngoCoords ? 11 : 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    const donorIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #2ecc71; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-home" style="color: white; font-size: 14px;"></i></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    const donorMarker = L.marker(donorCoords, { icon: donorIcon }).addTo(map);
    donorMarker.bindPopup(`<strong>Donor Location</strong><br>${donorLocation}`).openPopup();
    
    if (ngoCoords && status !== 'pending') {
        const ngoIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background: #3498db; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-building" style="color: white; font-size: 14px;"></i></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        const ngoMarker = L.marker(ngoCoords, { icon: ngoIcon }).addTo(map);
        ngoMarker.bindPopup(`<strong>NGO Location</strong><br>${ngoLocation}`);
        
        if (status !== 'pending') {
            const routeColor = status === 'in-transit' || status === 'delivered' || status === 'completed' ? '#e67e22' : '#3498db';
            const route = L.polyline([donorCoords, ngoCoords], {
                color: routeColor,
                weight: 4,
                opacity: 0.7,
                dashArray: status === 'in-transit' || status === 'delivered' || status === 'completed' ? '10, 10' : '0'
            }).addTo(map);
            
            if (status === 'in-transit' || status === 'delivered' || status === 'completed') {
                const progress = status === 'delivered' || status === 'completed' ? 1 : 0.6;
                const transitLat = donorCoords[0] + (ngoCoords[0] - donorCoords[0]) * progress;
                const transitLng = donorCoords[1] + (ngoCoords[1] - donorCoords[1]) * progress;
                
                const vehicleIcon = L.divIcon({
                    className: 'custom-marker vehicle-marker',
                    html: '<div style="background: #e67e22; width: 35px; height: 35px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; animation: pulse-vehicle 2s infinite;"><i class="fas fa-truck" style="color: white; font-size: 16px;"></i></div>',
                    iconSize: [35, 35],
                    iconAnchor: [17, 17]
                });
                
                const vehicleMarker = L.marker([transitLat, transitLng], { icon: vehicleIcon }).addTo(map);
                vehicleMarker.bindPopup(`<strong>Delivery Vehicle</strong><br>${status === 'delivered' || status === 'completed' ? 'Delivered' : 'In Transit'}`);
            }
        }
        
        map.fitBounds([donorCoords, ngoCoords], { padding: [50, 50] });
    } else {
        map.setView(donorCoords, 12);
    }
    
    trackingMaps[donationId] = map;
}

function getStatusInfo(status) {
    const statusMap = {
        'pending': { label: 'Posted', icon: 'fa-clock', color: '#f39c12', description: 'Donation posted and waiting for NGO to accept' },
        'accepted': { label: 'Accepted', icon: 'fa-check-circle', color: '#3498db', description: 'NGO has accepted and will collect soon' },
        'collected': { label: 'Picked Up', icon: 'fa-box', color: '#9b59b6', description: 'Food has been picked up from the donor' },
        'in-transit': { label: 'In Transit', icon: 'fa-truck', color: '#e67e22', description: 'Food is being delivered to recipients' },
        'delivered': { label: 'Delivered', icon: 'fa-check-double', color: '#2ecc71', description: 'Successfully delivered to people in need' },
        'completed': { label: 'Delivered', icon: 'fa-check-double', color: '#2ecc71', description: 'Successfully delivered to people in need' }
    };
    return statusMap[status] || statusMap['pending'];
}

function getStatusSteps(status) {
    const steps = [
        { key: 'pending', label: 'Posted', icon: 'fa-plus-circle' },
        { key: 'accepted', label: 'Accepted', icon: 'fa-handshake' },
        { key: 'collected', label: 'Collected', icon: 'fa-box' },
        { key: 'in-transit', label: 'In Transit', icon: 'fa-truck' },
        { key: 'delivered', label: 'Delivered', icon: 'fa-check' }
    ];
    
    const statusOrder = ['pending', 'accepted', 'collected', 'in-transit', 'delivered', 'completed'];
    const currentIndex = statusOrder.indexOf(status);
    
    return steps.map((step, index) => {
        const stepKeyIndex = statusOrder.indexOf(step.key);
        return {
            ...step,
            completed: stepKeyIndex <= currentIndex,
            active: stepKeyIndex === currentIndex
        };
    });
}

function loadTracking() {
    let donationsToTrack = [];
    
    if (currentUser.role === 'donor') {
        donationsToTrack = allDonations.filter(d => d.donorId === currentUser.id);
    } else if (currentUser.role === 'ngo') {
        donationsToTrack = allDonations.filter(d => d.acceptedBy === currentUser.id);
    } else if (currentUser.role === 'volunteer') {
        donationsToTrack = allDonations.filter(d => d.assignedTo === currentUser.id);
    } else {
        donationsToTrack = [];
    }
    
    if (donationsToTrack.length === 0) {
        document.getElementById('trackingList').innerHTML = `
            <div style="text-align: center; padding: 3rem; background: var(--light); border-radius: 10px;">
                <i class="fas fa-inbox" style="font-size: 3rem; color: var(--text); opacity: 0.3; margin-bottom: 1rem;"></i>
                <p style="color: var(--text); opacity: 0.7;">No donations to track yet. ${currentUser.role === 'donor' ? 'Post a donation to start tracking!' : 'Accepted donations will appear here.'}</p>
            </div>
        `;
        return;
    }
    
    donationsToTrack.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const html = donationsToTrack.map(donation => {
        const statusInfo = getStatusInfo(donation.status);
        const steps = getStatusSteps(donation.status);
        const ngo = donation.acceptedBy ? allUsers.find(u => u.id === donation.acceptedBy) : null;
        const donor = allUsers.find(u => u.id === donation.donorId);
        
        return `
            <div class="tracking-card">
                <div class="tracking-header">
                    <div class="tracking-title-section">
                        <h3>${(donation.foodName || donation.foodCategory || 'Food').charAt(0).toUpperCase() + (donation.foodName || donation.foodCategory || 'Food').slice(1)} - ${donation.quantity} ${donation.unit || 'kg'}</h3>
                        <div class="tracking-meta">
                            <span><i class="fas fa-map-marker-alt"></i> ${donation.pickup && donation.pickup.city ? `${donation.pickup.city}, ${donation.pickup.state || ''}` : donation.donorLocation}</span>
                            <span><i class="fas fa-calendar"></i> ${new Date(donation.createdAt).toLocaleDateString()}</span>
                            ${donation.acceptedAt ? `<span><i class="fas fa-clock"></i> Accepted: ${new Date(donation.acceptedAt).toLocaleDateString()}</span>` : ''}
                            ${donation.expiryAt ? `<span><i class="fas fa-hourglass-end"></i> Expires: ${new Date(donation.expiryAt).toLocaleString()}</span>` : ''}
                        </div>
                    </div>
                    <div class="tracking-status-badge" style="background: ${statusInfo.color}20; color: ${statusInfo.color}; border: 2px solid ${statusInfo.color};">
                        <i class="fas ${statusInfo.icon}"></i>
                        <span>${statusInfo.label}</span>
                    </div>
                </div>
                
                ${donation.description ? `<p class="tracking-description">${donation.description}</p>` : ''}
                
                ${ngo || (currentUser.role === 'ngo' && donor) ? `
                <div class="tracking-map-container" id="map-container-${donation.id}">
                    <div class="map-header">
                        <h4><i class="fas fa-map-marked-alt"></i> Delivery Route</h4>
                        <button class="btn-map-toggle" onclick="toggleMap('${donation.id}')">
                            <i class="fas fa-expand-alt"></i> <span id="toggle-text-${donation.id}">Fullscreen</span>
                        </button>
                    </div>
                    <div id="map-${donation.id}" class="tracking-map"></div>
                </div>
                ` : ''}
                
                <div class="tracking-parties">
                    ${currentUser.role === 'donor' && ngo ? `
                        <div class="tracking-party">
                            <strong>Accepted by:</strong> ${ngo.name} <span style="color: var(--text); opacity: 0.7;">(${ngo.location})</span>
                        </div>
                    ` : ''}
                    ${currentUser.role === 'ngo' && donor ? `
                        <div class="tracking-party">
                            <strong>Donated by:</strong> ${donor.name} <span style="color: var(--text); opacity: 0.7;">(${donor.location})</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="tracking-timeline">
                    <div class="timeline-title">Progress Timeline</div>
                    <div class="timeline-steps">
                        ${steps.map((step, index) => `
                            <div class="timeline-step">
                                <div class="timeline-step-content">
                                    <div class="timeline-icon ${step.completed ? 'completed' : ''} ${step.active ? 'active' : ''}" 
                                         style="${step.completed ? `background: ${statusInfo.color};` : 'background: var(--light);'} 
                                                ${step.active ? `border: 3px solid ${statusInfo.color};` : ''}">
                                        <i class="fas ${step.icon}"></i>
                                    </div>
                                    <div class="timeline-label">${step.label}</div>
                                </div>
                                ${index < steps.length - 1 ? `
                                    <div class="timeline-connector ${step.completed ? 'completed' : ''}" 
                                         style="${step.completed ? `background: ${statusInfo.color};` : 'background: var(--light);'}"></div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <div class="timeline-status-desc">
                        <i class="fas ${statusInfo.icon}" style="color: ${statusInfo.color};"></i>
                        <span>${statusInfo.description}</span>
                    </div>
                    ${Array.isArray(donation.statusHistory) && donation.statusHistory.length ? `
                    <div style="margin-top: 1rem; font-size: 0.85rem; color: var(--text);">
                        <strong>Status History:</strong>
                        <ul style="margin-top: 0.5rem; padding-left: 1.2rem;">
                            ${donation.statusHistory.map(h => `
                                <li>${getStatusInfo(h.status).label} at ${new Date(h.at).toLocaleString()}</li>
                            `).join('')}
                        </ul>
                    </div>
                    ` : ''}
                </div>
                
                ${(donation.status === 'pending' && currentUser.role === 'donor') || (donation.status === 'accepted' && currentUser.role === 'ngo') ? `
                    <div class="tracking-actions">
                        ${currentUser.role === 'donor' && ngo ? `
                            <button class="btn-action" onclick="navigateToChat('${ngo.id}', '${ngo.name}')">
                                <i class="fas fa-comments"></i> Contact NGO
                            </button>
                        ` : ''}
                        ${currentUser.role === 'ngo' && donation.status === 'accepted' ? `
                            <button class="btn-action" onclick="updateDonationStatus('${donation.id}', 'collected')">
                                <i class="fas fa-box"></i> Mark as Collected
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    document.getElementById('trackingList').innerHTML = html;
    
    setTimeout(() => {
        donationsToTrack.forEach(donation => {
            const ngo = donation.acceptedBy ? allUsers.find(u => u.id === donation.acceptedBy) : null;
            const donor = allUsers.find(u => u.id === donation.donorId);
            if (ngo || (currentUser.role === 'ngo' && donor)) {
                initializeTrackingMap(
                    donation.id,
                    donation.donorLocation,
                    ngo ? ngo.location : (currentUser.role === 'ngo' && donor ? donor.location : null),
                    donation.status
                );
            }
        });
    }, 100);
}

function toggleMap(donationId) {
    const mapContainer = document.getElementById(`map-container-${donationId}`);
    const mapDiv = document.getElementById(`map-${donationId}`);
    const toggleText = document.getElementById(`toggle-text-${donationId}`);
    
    if (!mapContainer || !mapDiv) return;
    
    if (mapContainer.classList.contains('fullscreen')) {
        mapContainer.classList.remove('fullscreen');
        if (toggleText) toggleText.textContent = 'Fullscreen';
        document.body.style.overflow = '';
        if (trackingMaps[donationId]) {
            setTimeout(() => trackingMaps[donationId].invalidateSize(), 300);
        }
    } else {
        mapContainer.classList.add('fullscreen');
        if (toggleText) toggleText.textContent = 'Exit Fullscreen';
        document.body.style.overflow = 'hidden';
        if (trackingMaps[donationId]) {
            setTimeout(() => trackingMaps[donationId].invalidateSize(), 300);
        }
    }
}

let publicTrackMap = null;

function initializeDefaultTrackMap() {
    const mapDiv = document.getElementById('trackOrderMap');
    if (!mapDiv) return;
    
    if (publicTrackMap) {
        try {
            publicTrackMap.remove();
        } catch(e) {
            console.log('Map cleanup:', e);
        }
        publicTrackMap = null;
    }
    
    try {
        publicTrackMap = L.map('trackOrderMap', {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([20.5937, 78.9629], 5);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(publicTrackMap);
        
        const infoIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background: #2ecc71; width: 50px; height: 50px; border-radius: 50%; border: 4px solid white; box-shadow: 0 3px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-map-marker-alt" style="color: white; font-size: 24px;"></i></div>',
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        });
        
        const centerMarker = L.marker([20.5937, 78.9629], { icon: infoIcon }).addTo(publicTrackMap);
        centerMarker.bindPopup('<strong>📍 Enter Tracking ID Above</strong><br>Track your food donation delivery in real-time').openPopup();
    } catch(e) {
        console.error('Error initializing map:', e);
    }
}

function trackOrderById() {
    const orderId = document.getElementById('trackOrderId').value.trim();
    const mapContainer = document.getElementById('trackOrderMapContainer');
    const mapDiv = document.getElementById('trackOrderMap');
    
    if (!orderId) {
        alert('Please enter a tracking ID');
        return;
    }
    
    const donation = allDonations.find(d => d.id === orderId);
    
    if (!donation) {
        alert('Order not found. Please check your tracking ID and try again.');
        return;
    }
    
    const donor = allUsers.find(u => u.id === donation.donorId);
    const ngo = donation.acceptedBy ? allUsers.find(u => u.id === donation.acceptedBy) : null;
    const statusInfo = getStatusInfo(donation.status);
    
    document.getElementById('trackOrderStatus').style.display = 'flex';
    document.getElementById('btnCloseTrack').style.display = 'block';
    document.getElementById('trackOrderDetails').style.display = 'grid';
    
    document.getElementById('trackOrderTitle').textContent = `${donation.foodType.charAt(0).toUpperCase() + donation.foodType.slice(1)} - ${donation.quantity} kg`;
    const statusBadge = document.getElementById('trackOrderStatus');
    statusBadge.innerHTML = `<i class="fas ${statusInfo.icon}"></i> ${statusInfo.label}`;
    statusBadge.style.background = `${statusInfo.color}20`;
    statusBadge.style.color = statusInfo.color;
    statusBadge.style.border = `2px solid ${statusInfo.color}`;
    
    if (publicTrackMap) {
        publicTrackMap.remove();
        publicTrackMap = null;
    }
    
    const donorCoords = getCityCoordinates(donation.donorLocation);
    const ngoCoords = ngo ? getCityCoordinates(ngo.location) : null;
    
    let centerLat = donorCoords[0];
    let centerLng = donorCoords[1];
    
    if (ngoCoords) {
        centerLat = (donorCoords[0] + ngoCoords[0]) / 2;
        centerLng = (donorCoords[1] + ngoCoords[1]) / 2;
    }
    
    publicTrackMap = L.map('trackOrderMap', {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView([centerLat, centerLng], ngoCoords ? 11 : 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(publicTrackMap);
    
    const donorIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #2ecc71; width: 35px; height: 35px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-home" style="color: white; font-size: 16px;"></i></div>',
        iconSize: [35, 35],
        iconAnchor: [17, 17]
    });
    
    const donorMarker = L.marker(donorCoords, { icon: donorIcon }).addTo(publicTrackMap);
    donorMarker.bindPopup(`<strong>📍 Donor Location</strong><br>${donor ? donor.name : 'Donor'}<br>${donation.donorLocation}`).openPopup();
    
    if (ngoCoords && ngo && donation.status !== 'pending') {
        const ngoIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background: #3498db; width: 35px; height: 35px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-building" style="color: white; font-size: 16px;"></i></div>',
            iconSize: [35, 35],
            iconAnchor: [17, 17]
        });
        
        const ngoMarker = L.marker(ngoCoords, { icon: ngoIcon }).addTo(publicTrackMap);
        ngoMarker.bindPopup(`<strong>🏢 NGO Location</strong><br>${ngo.name}<br>${ngo.location}`);
        
        const routeColor = donation.status === 'in-transit' || donation.status === 'delivered' || donation.status === 'completed' ? '#e67e22' : '#3498db';
        const route = L.polyline([donorCoords, ngoCoords], {
            color: routeColor,
            weight: 5,
            opacity: 0.8,
            dashArray: donation.status === 'in-transit' || donation.status === 'delivered' || donation.status === 'completed' ? '10, 10' : '0'
        }).addTo(publicTrackMap);
        
        if (donation.status === 'in-transit' || donation.status === 'delivered' || donation.status === 'completed') {
            const progress = donation.status === 'delivered' || donation.status === 'completed' ? 1 : 0.6;
            const transitLat = donorCoords[0] + (ngoCoords[0] - donorCoords[0]) * progress;
            const transitLng = donorCoords[1] + (ngoCoords[1] - donorCoords[1]) * progress;
            
            const vehicleIcon = L.divIcon({
                className: 'custom-marker vehicle-marker',
                html: '<div style="background: #e67e22; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;"><i class="fas fa-truck" style="color: white; font-size: 18px;"></i></div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
            
            const vehicleMarker = L.marker([transitLat, transitLng], { icon: vehicleIcon }).addTo(publicTrackMap);
            vehicleMarker.bindPopup(`<strong>🚚 Delivery Vehicle</strong><br>${donation.status === 'delivered' || donation.status === 'completed' ? 'Delivered ✅' : 'In Transit...'}`);
        }
        
        publicTrackMap.fitBounds([donorCoords, ngoCoords], { padding: [50, 50] });
    } else {
        publicTrackMap.setView(donorCoords, 12);
    }
    
    const detailsHtml = `
        <div class="track-detail-item">
            <strong>Order ID:</strong> <span>${donation.id}</span>
        </div>
        <div class="track-detail-item">
            <strong>Status:</strong> <span style="color: ${statusInfo.color}; font-weight: 600;">${statusInfo.label}</span>
        </div>
        ${donor ? `
        <div class="track-detail-item">
            <strong>Donor:</strong> <span>${donor.name}</span>
        </div>
        ` : ''}
        ${ngo ? `
        <div class="track-detail-item">
            <strong>NGO:</strong> <span>${ngo.name}</span>
        </div>
        ` : ''}
        <div class="track-detail-item">
            <strong>Location:</strong> <span>${donation.donorLocation}</span>
        </div>
        <div class="track-detail-item">
            <strong>Created:</strong> <span>${new Date(donation.createdAt).toLocaleString()}</span>
        </div>
        ${donation.acceptedAt ? `
        <div class="track-detail-item">
            <strong>Accepted:</strong> <span>${new Date(donation.acceptedAt).toLocaleString()}</span>
        </div>
        ` : ''}
        ${donation.description ? `
        <div class="track-detail-item">
            <strong>Description:</strong> <span>${donation.description}</span>
        </div>
        ` : ''}
    `;
    
    document.getElementById('trackOrderDetails').innerHTML = detailsHtml;
    
    setTimeout(() => {
        document.getElementById('trackOrder').scrollIntoView({ behavior: 'smooth', block: 'start' });
        publicTrackMap.invalidateSize();
    }, 100);
}

function resetTrackOrder() {
    document.getElementById('trackOrderStatus').style.display = 'none';
    document.getElementById('btnCloseTrack').style.display = 'none';
    document.getElementById('trackOrderDetails').style.display = 'none';
    
    document.getElementById('trackOrderTitle').textContent = 'Track Your Delivery';
    
    document.getElementById('trackOrderId').value = '';
    
    if (publicTrackMap) {
        publicTrackMap.remove();
        publicTrackMap = null;
    }
    
    setTimeout(() => {
        initializeDefaultTrackMap();
    }, 100);
}

function closeTrackOrder() {
    resetTrackOrder();
}

function updateDonationStatus(donationId, newStatus) {
    const donation = allDonations.find(d => d.id === donationId);
    if (donation) {
        donation.status = newStatus;
        if (newStatus === 'collected') {
            donation.collectedAt = new Date().toISOString();
        } else if (newStatus === 'in-transit') {
            donation.inTransitAt = new Date().toISOString();
        } else if (newStatus === 'delivered' || newStatus === 'completed') {
            donation.deliveredAt = new Date().toISOString();
        }
        if (!Array.isArray(donation.statusHistory)) donation.statusHistory = [];
        donation.statusHistory.push({ status: newStatus, at: new Date().toISOString() });
        saveToStorage('donations', allDonations);
        if (database) {
            database.ref('donations/' + donationId).update(donation);
        }
        loadTracking();
        loadDashboardData();
        alert('Status updated successfully!');
    }
}

function navigateToChat(userId, userName) {
    if (userId && userName) {
        startChat(userId, userName);
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('chat').classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.textContent.includes('Messages')) {
                btn.classList.add('active');
            }
        });
        loadConversations();
    }
}

function loadDashboardData() {
    const totalMeals = allDonations.length;
    const totalNGOs = allUsers.filter(u => u.role === 'ngo').length;
    const totalUsers = allUsers.length;
    const pendingDonations = allDonations.filter(d => d.status === 'pending').length;

    document.getElementById('totalMeals').textContent = totalMeals;
    document.getElementById('totalNGOs').textContent = totalNGOs;
    document.getElementById('totalCities').textContent = new Set(allUsers.map(u => u.location)).size;

    document.getElementById('dashTotalMeals').textContent = totalMeals;
    document.getElementById('dashTotalNGOs').textContent = totalNGOs;
    document.getElementById('dashTotalUsers').textContent = totalUsers;
    document.getElementById('dashPendingDonations').textContent = pendingDonations;

    const userDonations = allDonations.filter(d => d.donorId === currentUser.id);
    document.getElementById('analyticsMeals').textContent = userDonations.length;
    document.getElementById('analyticsRecipients').textContent = userDonations.reduce((sum, d) => sum + parseInt(d.quantity), 0);
    document.getElementById('analyticsWastePrevented').textContent = (userDonations.reduce((sum, d) => sum + parseInt(d.quantity), 0)).toFixed(1);
    document.getElementById('analyticsEmissionsSaved').textContent = (userDonations.reduce((sum, d) => sum + parseInt(d.quantity), 0) * 2.5).toFixed(1);
}

function handleContact(e) {
    e.preventDefault();

    const contactData = {
        name: document.getElementById('contactName').value,
        email: document.getElementById('contactEmail').value,
        message: document.getElementById('contactMessage').value,
        timestamp: new Date().toISOString()
    };

    let contacts = JSON.parse(localStorage.getItem('contacts') || '[]');
    contacts.push(contactData);
    localStorage.setItem('contacts', JSON.stringify(contacts));

    if (typeof emailjs !== 'undefined') {
        emailjs.send("service_id", "template_id", {
            to_email: "contact@feedferry.com",
            from_name: contactData.name,
            from_email: contactData.email,
            message: contactData.message
        }).then(() => {
            alert('Message sent successfully! We\'ll get back to you soon.');
        }).catch(err => {
            alert('Message saved. Email service unavailable.');
            console.log(err);
        });
    } else {
        alert('Thank you for contacting us! We\'ll get back to you soon.');
    }

    if (database) {
        database.ref('contacts/' + Math.random().toString(36).substr(2, 9)).set(contactData);
    }

    e.target.reset();
}

function saveToStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function loadFromStorage(key) {
    return JSON.parse(localStorage.getItem(key) || '[]');
}

document.addEventListener('DOMContentLoaded', () => {
    allUsers = loadFromStorage('users');
    allDonations = loadFromStorage('donations');
    allMessages = loadFromStorage('messages');

    if (allUsers.length === 0) {
        allUsers = [
            { id: '1', name: 'Aarav Sharma', email: 'donor@test.com', password: '123456', role: 'donor', location: 'Mumbai', createdAt: new Date().toISOString() },
            { id: '2', name: 'Seva Sahayog Foundation', email: 'ngo@test.com', password: '123456', role: 'ngo', location: 'Mumbai', createdAt: new Date().toISOString() },
            { id: '3', name: 'Neha Patil', email: 'volunteer@test.com', password: '123456', role: 'volunteer', location: 'Mumbai', createdAt: new Date().toISOString() },
            { id: '4', name: 'Riya Deshmukh', email: 'donor2@test.com', password: '123456', role: 'donor', location: 'Pune', createdAt: new Date().toISOString() },
            { id: '5', name: 'Asha Food Bank NGO', email: 'ngo2@test.com', password: '123456', role: 'ngo', location: 'Pune', createdAt: new Date().toISOString() }
        ];
        saveToStorage('users', allUsers);
    }

    const saved = localStorage.getItem('currentUser');
    if (saved) {
        currentUser = JSON.parse(saved);
        showDashboard();
        loadDashboardData();
    }

    loadDashboardData();
    renderNavbarLinks();
    initLocationDropdowns();
    
    setTimeout(() => {
        const trackSection = document.querySelector('.track-order-section');
        if (trackSection && trackSection.style.display !== 'none') {
            initializeDefaultTrackMap();
        }
    }, 500);

    // Navbar shadow on scroll (subtle polish)
    const navbar = document.querySelector('.navbar');
    function updateNavbarShadow() {
        if (!navbar) return;
        if (window.scrollY > 6) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    }
    updateNavbarShadow();
    window.addEventListener('scroll', updateNavbarShadow, { passive: true });

    // Scroll reveal animations
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const candidates = document.querySelectorAll(
            '.hero-title, .hero-subtitle, .hero-buttons, .hero-stats, ' +
            '.section-title, .problem-card, .feature-card, .impact-card, .step-card, ' +
            '.track-input-section, .track-map-container, .contact-grid, .cta-section, .footer-content, ' +
            '.sidebar, .main-content'
        );

        candidates.forEach((el, idx) => {
            el.classList.add('reveal');
            // Small stagger but capped so it doesn't feel slow
            const mod = idx % 4;
            if (mod === 1) el.classList.add('delay-1');
            if (mod === 2) el.classList.add('delay-2');
            if (mod === 3) el.classList.add('delay-3');
        });

        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        io.unobserve(entry.target);
                    }
                });
            },
            { root: null, threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
        );

        candidates.forEach((el) => io.observe(el));
    }

    // Live-ish chat sync:
    // - If the app is open in multiple tabs (different logged-in users), messages will sync via the storage event.
    window.addEventListener('storage', (ev) => {
        if (ev.key === 'messages') refreshMessagesFromStorage();
        if (ev.key === 'users') allUsers = loadFromStorage('users');
        if (ev.key === 'donations') allDonations = loadFromStorage('donations');
    });
    // Fallback polling (helps if storage events are missed)
    setInterval(refreshMessagesFromStorage, 1500);
});

window.onclick = function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
};

