const STORAGE_KEY = "lia.location.permission";

function shapePosition(position) {
  const coords = position?.coords;
  if (!coords) return null;
  return {
    permission: true,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? 0,
    source: "browser",
    timestamp: Date.now(),
  };
}

export function getStoredLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved?.permission ? saved : null;
  } catch {
    return null;
  }
}

export function clearStoredLocation() {
  localStorage.removeItem(STORAGE_KEY);
}

export function requestCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const location = shapePosition(position);
        if (location) localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
        resolve(location);
      },
      error => reject(error),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

export async function getLocationForTurn(enabled) {
  if (!enabled) return null;
  try {
    return await requestCurrentLocation();
  } catch (error) {
    if (error?.code === 1) {
      clearStoredLocation();
      return null;
    }
    return getStoredLocation();
  }
}
