console.log("popup.js loaded");

async function fetchDestinations(origin) {
  const pageData = localStorage.getItem("wizz_page_data");
  if (pageData) {
    const data = JSON.parse(pageData);
    const oneHourInMs = 60 * 60 * 1000;
    if (Date.now() - data.timestamp < oneHourInMs && data.routes) {
      console.log("Using cached routes data");
      const routesFromOrigin = data.routes.find(
        (route) => route.departureStation.id === origin
      );
      if (routesFromOrigin && routesFromOrigin.arrivalStations) {
        const destinationIds = routesFromOrigin.arrivalStations.map(
          (station) => station.id
        );
        console.log(`Routes from ${origin}:`, destinationIds);
        return destinationIds;
      }
    }
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      if (currentTab.url.includes("multipass.wizzair.com")) {
        chrome.tabs.sendMessage(
          currentTab.id,
          { action: "getDestinations", origin: origin },
          function (response) {
            if (response && response.routes) {
              const pageData = {
                routes: response.routes,
                timestamp: Date.now(),
              };
              localStorage.setItem("wizz_page_data", JSON.stringify(pageData));

              const routesFromOrigin = response.routes.find(
                (route) => route.departureStation.id === origin
              );
              if (routesFromOrigin && routesFromOrigin.arrivalStations) {
                const destinationIds = routesFromOrigin.arrivalStations.map(
                  (station) => station.id
                );
                console.log(`Routes from ${origin}:`, destinationIds);
                resolve(destinationIds);
              } else {
                reject(new Error(`No routes found from ${origin}`));
              }
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              reject(new Error("Failed to fetch destinations"));
            }
          }
        );
      } else {
        chrome.tabs.create({
          url: "https://multipass.wizzair.com/w6/subscriptions/spa/private-page/wallets",
        });
        reject(
          new Error(
            "Not on the Wizzair Multipass page. Opening the correct page for you. Please enter any random route and press Search."
          )
        );
      }
    });
  });
}

async function getDynamicUrl() {
  const pageData = localStorage.getItem("wizz_page_data");
  if (pageData) {
    const data = JSON.parse(pageData);
    const oneHourInMs = 60 * 60 * 1000;
    if (Date.now() - data.timestamp < oneHourInMs && data.dynamicUrl) {
      console.log("Using cached dynamic URL");
      return data.dynamicUrl;
    }
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      chrome.tabs.sendMessage(
        currentTab.id,
        { action: "getDynamicUrl" },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response && response.dynamicUrl) {
            const pageData = JSON.parse(
              localStorage.getItem("wizz_page_data") || "{}"
            );
            pageData.dynamicUrl = response.dynamicUrl;
            pageData.timestamp = Date.now();
            localStorage.setItem("wizz_page_data", JSON.stringify(pageData));
            resolve(response.dynamicUrl);
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            reject(new Error("Failed to get dynamic URL"));
          }
        }
      );
    });
  });
}

async function checkRoute(origin, destination, date) {
  try {
    const delay = Math.floor(Math.random() * (1000 - 500 + 1)) + 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    const dynamicUrl = await getDynamicUrl();
    const pageData = JSON.parse(localStorage.getItem("wizz_page_data") || "{}");

    const data = {
      flightType: "OW",
      origin: origin,
      destination: destination,
      departure: date,
      arrival: "",
      intervalSubtype: null,
    };

    let headers = {
      'Content-Type': 'application/json',
    };

    const oneHourInMs = 60 * 60 * 1000;
    if (pageData.headers && Date.now() - pageData.timestamp < oneHourInMs) {
      console.log("Using cached headers");
      headers = { ...headers, ...pageData.headers };
    } else {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: "getHeaders" }, resolve);
      });
      if (response && response.headers) {
        headers = { ...headers, ...response.headers };
      } else {
        console.log("Failed to get headers from the page, using defaults");
      }
    }

    const fetchResponse = await fetch(dynamicUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    });

    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! status: ${fetchResponse.status}`);
    }

    const responseData = await fetchResponse.json();
    return responseData.flightsOutbound || [];
  } catch (error) {
    console.error("Error in checkRoute:", error);
    if (error.message.includes("429")) {
      document.querySelector("#rate-limited-message").style.display = "block";
    }
    throw error;
  }
}

function cacheKey(origin, date) {
  const [year, month, day] = date.split("-");
  return `${origin}-${year}-${month}-${day}`;
}

function setCachedResults(key, results) {
  const cacheData = {
    results: results,
    timestamp: Date.now(),
  };
  localStorage.setItem(key, JSON.stringify(cacheData));
}

function getCachedResults(key) {
  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    const { results, timestamp } = JSON.parse(cachedData);
    const eightHoursInMs = 8 * 60 * 60 * 1000;
    if (Date.now() - timestamp < eightHoursInMs) {
      return results;
    } else {
      clearCache(key);
    }
  }
  return null;
}

function clearCache(key) {
  localStorage.removeItem(key);
}

async function checkAllRoutes() {
  console.log("checkAllRoutes started");

  const audioCheckbox = document.getElementById("play-audio-checkbox");
  const audioPlayer = document.getElementById("background-music");
  if (audioCheckbox.checked && audioPlayer) {
    audioPlayer.play();
  }

  const originInput = document.getElementById("airport-input");
  const dateSelect = document.getElementById("date-select");
  const origin = originInput.value.toUpperCase();
  const selectedDate = dateSelect.value;

  if (!origin) {
    alert("Please enter a departure airport code.");
    return;
  }

  // Clear previous results
  let routeListElement = document.querySelector(".route-list");
  document.querySelector("#rate-limited-message").style.display = "none";
  routeListElement.innerHTML = "";

  const cacheKey = `${origin}-${selectedDate}`;
  const cachedResults = getCachedResults(cacheKey);

  if (cachedResults) {
    console.log("Using cached results");
    displayResults({ [selectedDate]: cachedResults });
    const routeListElement = document.querySelector(".route-list");
    const cacheNotification = document.createElement("div");
    cacheNotification.textContent =
      'Using cached results. Click the "Refresh Cache" button to fetch new data.';
    cacheNotification.style.backgroundColor = "#e6f7ff";
    cacheNotification.style.border = "1px solid #91d5ff";
    cacheNotification.style.borderRadius = "4px";
    cacheNotification.style.padding = "10px";
    cacheNotification.style.marginBottom = "15px";
    routeListElement.insertBefore(
      cacheNotification,
      routeListElement.firstChild
    );

    // Stop and remove audio player when using cached results
    const audioPlayer = document.getElementById("background-music");
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.remove();
    }
    return;
  }

  const flightsByDate = {};

  if (!routeListElement) {
    console.error("Error: .route-list element not found in the DOM");
    return;
  }

  try {
    const destinations = await fetchDestinations(origin);
    console.log("Fetched destinations:", destinations);

    const progressElement = document.createElement("div");
    progressElement.id = "progress";
    progressElement.style.marginBottom = "10px";
    routeListElement.insertBefore(progressElement, routeListElement.firstChild);

    const results = [];
    let completedRoutes = 0;
    let isRateLimited = false;

    for (const destination of destinations) {
      if (isRateLimited) break;

      if (completedRoutes > 0 && completedRoutes % 25 === 0) {
        progressElement.textContent = `Taking a 15 second break to avoid rate limiting...`;
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }

      const updateProgress = () => {
        progressElement.textContent = `Checking ${origin} to ${destination}... ${completedRoutes}/${destinations.length}`;
      };
      try {
        const flights = await checkRoute(origin, destination, selectedDate);
        if (flights && flights.length > 0) {
          flights.forEach((flight) => {
            const flightInfo = {
              route: `${origin} (${flight.departureStationText}) to ${destination} (${flight.arrivalStationText}) - ${flight.flightCode}`,
              date: flight.departureDate,
              departure: `${flight.departure} (${flight.departureOffsetText})`,
              arrival: `${flight.arrival} (${flight.arrivalOffsetText})`,
              duration: flight.duration,
            };

            results.push(flightInfo);

            if (!flightsByDate[selectedDate]) {
              flightsByDate[selectedDate] = [];
            }
            flightsByDate[selectedDate].push(flightInfo);
            displayResults(flightsByDate, true);
          });
        }
      } catch (error) {
        console.error(
          `Error processing ${origin} to ${destination} on ${selectedDate}:`,
          error.message
        );

        if (
          error.message.includes("429") ||
          error.message.includes("Rate limited")
        ) {
          isRateLimited = true;
          document.querySelector("#rate-limited-message").style.display =
            "block";
          break;
        }
      }

      completedRoutes++;
      updateProgress();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    progressElement.remove();

    if (!isRateLimited) {
      if (results.length === 0) {
        routeListElement.innerHTML = `<p class="is-size-4 has-text-centered">No flights available for ${selectedDate}.</p>`;
      } else {
        setCachedResults(cacheKey, flightsByDate[selectedDate]);
        await displayResults(flightsByDate);
      }

      const audioPlayer = document.getElementById("background-music");
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.remove();
      }
    }
  } catch (error) {
    console.error("An error occurred:", error.message);
    routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;

    const audioPlayer = document.getElementById("background-music");
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.remove();
    }
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayResults(flightsByDate, append = false) {
    const resultsDiv = document.querySelector('.route-list');
    if (!resultsDiv) return;

    if (!append) {
        resultsDiv.innerHTML = '';
    }

    for (const [date, flights] of Object.entries(flightsByDate)) {
        if (flights.length > 0) {
            const dateHeader = document.createElement('h3');
            dateHeader.textContent = `Flights on ${date}`;
            resultsDiv.appendChild(dateHeader);

            const flightList = document.createElement('ul');
            flightList.style.listStyleType = 'none';
            flightList.style.padding = '0';

            flights.forEach(flight => {
                const flightItem = document.createElement('li');
                flightItem.style.marginBottom = '15px';
                flightItem.style.padding = '10px';
                flightItem.style.border = '1px solid #ddd';
                flightItem.style.borderRadius = '5px';

                const routeDiv = document.createElement('div');
                routeDiv.textContent = `Route: ${flight.route}`;
                routeDiv.classList.add('route');
                routeDiv.style.fontWeight = 'bold';

                const dateDiv = document.createElement('div');
                dateDiv.textContent = `Date: ${flight.date}`;
                dateDiv.classList.add('date');

                const departureDiv = document.createElement('div');
                departureDiv.textContent = `Departure: ${flight.departure}`;
                departureDiv.classList.add('departure');

                const arrivalDiv = document.createElement('div');
                arrivalDiv.textContent = `Arrival: ${flight.arrival}`;
                arrivalDiv.classList.add('arrival');

                const durationDiv = document.createElement('div');
                durationDiv.textContent = `Duration: ${flight.duration}`;
                durationDiv.classList.add('duration');

                // Compute and display the correct duration
                const computedDurationDiv = document.createElement('div');
                const computedDuration = computeDuration(flight.departure, flight.arrival);
                computedDurationDiv.textContent = `Computed Duration: ${computedDuration}`;
                computedDurationDiv.classList.add('computed-duration');

                flightItem.appendChild(routeDiv);
                flightItem.appendChild(dateDiv);
                flightItem.appendChild(departureDiv);
                flightItem.appendChild(arrivalDiv);
                flightItem.appendChild(durationDiv);
                flightItem.appendChild(computedDurationDiv); // Add computed duration
                flightList.appendChild(flightItem);
            });

            resultsDiv.appendChild(flightList);
        }
    }
}

async function findReturnFlight(outboundFlight) {
  const origin = outboundFlight.route.split(" to ")[1].split(" (")[0];
  const destination = outboundFlight.route.split(" to ")[0].split(" (")[0];
  const outboundDate = new Date(outboundFlight.date);
  const outboundArrivalTime = outboundFlight.arrival.split(" (")[0];

  const returnDates = [];
  for (let i = 0; i < 4; i++) {
    const date = new Date(outboundDate);
    date.setDate(outboundDate.getDate() + i);
    returnDates.push(formatDate(date));
  }

  const returnFlights = [];

  const progressElement = document.createElement("div");
  progressElement.classList.add("return-flight-progress");
  progressElement.style.marginTop = "10px";
  progressElement.style.fontSize = "0.9em";
  progressElement.style.color = "#000";
  outboundFlight.element.appendChild(progressElement);

  let checkedDates = 0;
  const updateProgress = () => {
    progressElement.textContent = `Checking return flights: ${checkedDates} of ${returnDates.length} dates checked...`;
  };

  updateProgress();

  for (const returnDate of returnDates) {
    console.log(`Checking return flights for ${returnDate}`);
    try {
      const flights = await checkRoute(origin, destination, returnDate);
      if (Array.isArray(flights)) {
        const validReturnFlights = flights.filter((flight) => {
          const [flightHours, flightMinutes] = flight.departure
            .split(" (")[0]
            .split(":");
          const flightDate = new Date(returnDate);
          flightDate.setHours(
            parseInt(flightHours, 10),
            parseInt(flightMinutes, 10),
            0,
            0
          );

          const [outboundHours, outboundMinutes] =
            outboundArrivalTime.split(":");
          const outboundArrival = new Date(outboundDate);
          outboundArrival.setHours(
            parseInt(outboundHours, 10),
            parseInt(outboundMinutes, 10),
            0,
            0
          );
          return flightDate > outboundArrival;
        });
        console.log(
          `Found ${validReturnFlights.length} valid return flights for ${returnDate}`
        );
        returnFlights.push(...validReturnFlights);
      } else {
        console.error(`Unexpected response format for ${returnDate}:`, flights);
      }
    } catch (error) {
      console.error(`Error checking return flight for ${returnDate}:`, error);
    }
    checkedDates++;
    updateProgress();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  progressElement.remove();

  console.log(`Total return flights found: ${returnFlights.length}`);
  displayReturnFlights(outboundFlight, returnFlights);

  return returnFlights;
}

function calculateTimeAtDestination(outboundFlight, returnFlight) {
  const outboundArrival = new Date(
    `${outboundFlight.date} ${outboundFlight.arrival.split(" (")[0]}`
  );
  const returnDeparture = new Date(
    `${returnFlight.departureDate} ${returnFlight.departure.split(" (")[0]}`
  );

  const timeDiff = returnDeparture - outboundArrival;
  const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );

  return `${days} days and ${hours} hours`;
}

function displayReturnFlights(outboundFlight, returnFlights) {
  const flightItem = outboundFlight.element;
  if (!flightItem) {
    console.error("Flight item element not found");
    return;
  }

  const existingReturnFlights = flightItem.querySelector(".return-flights");
  if (existingReturnFlights) {
    existingReturnFlights.remove();
  }

  const returnFlightsDiv = document.createElement("div");
  returnFlightsDiv.classList.add("return-flights");
  returnFlightsDiv.style.marginTop = "15px";
  returnFlightsDiv.style.borderTop = "2px solid #ddd";
  returnFlightsDiv.style.paddingTop = "15px";

  const validReturnFlights = returnFlights.filter((flight) => {
    const timeAtDestination = calculateTimeAtDestination(
      outboundFlight,
      flight
    );
    const [days, hours] = timeAtDestination.split(" and ");
    return parseInt(days) > 0 || parseInt(hours) >= 1;
  });

  const header = document.createElement("h4");
  header.textContent = `Return Flights (${validReturnFlights.length} found)`;
  header.style.marginBottom = "15px";
  header.style.fontWeight = "bold";
  returnFlightsDiv.appendChild(header);

  if (validReturnFlights.length === 0) {
    const noFlightsMsg = document.createElement("p");
    noFlightsMsg.textContent =
      "No valid (>1h until return) flights found within the next 3 days.";
    noFlightsMsg.style.fontStyle = "italic";
    returnFlightsDiv.appendChild(noFlightsMsg);
  } else {
    const flightList = document.createElement("ul");
    flightList.style.listStyleType = "none";
    flightList.style.padding = "0";

    validReturnFlights.forEach((flight) => {
      const returnFlightItem = document.createElement("li");
      returnFlightItem.style.marginBottom = "15px";
      returnFlightItem.style.padding = "10px";
      returnFlightItem.style.border = "1px solid #ddd";
      returnFlightItem.style.borderRadius = "5px";

      const routeDiv = document.createElement("div");
      routeDiv.textContent = `${
        flight.departureStationText || flight.departureStation
      } to ${flight.arrivalStationText || flight.arrivalStation} - ${
        flight.flightCode
      }`;
      routeDiv.style.fontWeight = "bold";
      routeDiv.style.marginBottom = "5px";

      const dateDiv = document.createElement("div");
      dateDiv.textContent = `Date: ${new Date(
        flight.departureDate
      ).toLocaleDateString()}`;
      dateDiv.style.fontSize = "0.9rem";
      dateDiv.style.color = "#4a4a4a";
      dateDiv.style.marginBottom = "5px";

      const detailsDiv = document.createElement("div");
      detailsDiv.style.display = "flex";
      detailsDiv.style.justifyContent = "space-between";
      detailsDiv.style.fontSize = "0.9em";

      const departureDiv = document.createElement("div");
      departureDiv.textContent = `✈️ Departure: ${flight.departure} (${
        flight.departureOffsetText || ""
      })`;

      const arrivalDiv = document.createElement("div");
      arrivalDiv.textContent = `🛬 Arrival: ${flight.arrival} (${
        flight.arrivalOffsetText || ""
      })`;

      const durationDiv = document.createElement("div");
      durationDiv.textContent = `⏱️ Duration: ${flight.duration}`;

      const timeAtDestinationDiv = document.createElement("div");
      const timeAtDestination = calculateTimeAtDestination(
        outboundFlight,
        flight
      );
      timeAtDestinationDiv.textContent = `🕒 Time until return: ${timeAtDestination}`;
      timeAtDestinationDiv.style.fontSize = "0.9em";
      timeAtDestinationDiv.style.color = "#4a4a4a";
      timeAtDestinationDiv.style.marginTop = "5px";

      detailsDiv.appendChild(departureDiv);
      detailsDiv.appendChild(arrivalDiv);
      detailsDiv.appendChild(durationDiv);

      returnFlightItem.appendChild(routeDiv);
      returnFlightItem.appendChild(dateDiv);
      returnFlightItem.appendChild(detailsDiv);
      returnFlightItem.appendChild(timeAtDestinationDiv);
      flightList.appendChild(returnFlightItem);
    });

    returnFlightsDiv.appendChild(flightList);
  }

  flightItem.appendChild(returnFlightsDiv);
}

function displayCacheButton() {
  const cacheButton = document.createElement("button");
  cacheButton.id = "show-cache";
  cacheButton.textContent = "Show Last Results (8h)";
  cacheButton.classList.add(
    "button",
    "has-background-primary",
    "mb-4",
    "ml-2",
    "has-text-white"
  );

  const searchFlightsButton = document.getElementById("search-flights");
  searchFlightsButton.parentNode.insertBefore(
    cacheButton,
    searchFlightsButton.nextSibling
  );

  cacheButton.addEventListener("click", showCachedResults);
}

function showCachedResults() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );

  const resultsDiv = document.querySelector(".route-list");
  resultsDiv.innerHTML = "";

  const headerContainer = document.createElement("div");
  headerContainer.style.display = "flex";
  headerContainer.style.justifyContent = "space-between";
  headerContainer.style.alignItems = "center";
  headerContainer.style.marginBottom = "4px";

  if (cacheKeys.length !== 0) {
    const header = document.createElement("h2");
    header.textContent = "Last Results (8h)";
    headerContainer.appendChild(header);
    const clearAllButton = document.createElement("button");
    clearAllButton.textContent = "Clear All";
    clearAllButton.classList.add("button", "is-small", "is-danger", "is-light");
    clearAllButton.addEventListener("click", clearAllCachedResults);
    headerContainer.appendChild(clearAllButton);
  }

  resultsDiv.appendChild(headerContainer);

  if (cacheKeys.length === 0) {
    const noResultsMessage = document.createElement("p");
    noResultsMessage.textContent = "Searched flights will appear here.";
    noResultsMessage.style.color = "#0f0f0f";
    resultsDiv.appendChild(noResultsMessage);
    return;
  }

  cacheKeys.forEach((key) => {
    const [origin, year, month, day] = key.split("-");
    const date = new Date(year, month - 1, day);
    const dayOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][date.getDay()];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const formattedDate = `${dayOfWeek}, ${
      monthNames[date.getMonth()]
    } ${date.getDate()}`;

    const button = document.createElement("button");
    button.style.marginTop = "5px";
    button.textContent = `${origin} - ${formattedDate}`;
    button.classList.add("button", "is-small", "is-light", "mr-2", "mb-2");
    button.addEventListener("click", () => displayCachedResult(key));
    resultsDiv.appendChild(button);
  });
}

function clearAllCachedResults() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );

  cacheKeys.forEach((key) => {
    localStorage.removeItem(key);
  });

  const resultsDiv = document.querySelector(".route-list");
  resultsDiv.innerHTML = "<p>All cached results have been cleared.</p>";
}

function displayCachedResult(key) {
  const cachedData = localStorage.getItem(key);
  if (cachedData) {
    // Stop and remove audio player when displaying cached results
    const audioPlayer = document.getElementById("background-music");
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.remove();
    }

    const { results, timestamp } = JSON.parse(cachedData);
    const [origin, year, month, day] = key.split("-");
    const date = `${year}-${month}-${day}`;

    const resultsDiv = document.querySelector(".route-list");
    resultsDiv.innerHTML = "";

    const cacheNotification = document.createElement("div");
    cacheNotification.textContent =
      'Using cached results. Click the "Refresh Cache" button to fetch new data.';
    cacheNotification.style.backgroundColor = "#e6f7ff";
    cacheNotification.style.border = "1px solid #91d5ff";
    cacheNotification.style.borderRadius = "4px";
    cacheNotification.style.padding = "10px";
    cacheNotification.style.marginBottom = "15px";

    const cacheInfoDiv = document.createElement("div");
    cacheInfoDiv.style.backgroundColor = "#e6f7ff";
    cacheInfoDiv.style.border = "1px solid #91d5ff";
    cacheInfoDiv.style.borderRadius = "4px";
    cacheInfoDiv.style.padding = "10px";
    cacheInfoDiv.style.marginBottom = "15px";

    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    cacheInfoDiv.innerHTML = `<p>Showing cached results for ${origin} on ${formattedDate}</p>
                              <p>Cache date: ${new Date(
                                timestamp
                              ).toLocaleString()}</p>`;

    const refreshButton = document.createElement("button");
    refreshButton.textContent = "♻️ Refresh Cache";
    refreshButton.style.marginTop = "10px";
    refreshButton.classList.add("button", "is-small", "is-info", "is-light");
    refreshButton.addEventListener("click", () => {
      clearCache(key);
      checkAllRoutes();
    });

    cacheInfoDiv.appendChild(refreshButton);
    cacheInfoDiv.appendChild(cacheNotification);
    resultsDiv.appendChild(cacheInfoDiv);

    displayResults({ [date]: results });

    results.forEach(async (flight) => {
      const returnCacheKey = `${key}-return-${flight.route}`;
      const cachedReturnData = localStorage.getItem(returnCacheKey);
      if (cachedReturnData) {
        const { results: returnFlights } = JSON.parse(cachedReturnData);
        displayReturnFlights(flight, returnFlights);
      }
    });
  } else {
    alert("Cached data not found.");
  }
}

function checkCacheValidity() {
  const cacheKeys = Object.keys(localStorage).filter((key) =>
    key.match(/^[A-Z]+-\d{4}-\d{2}-\d{2}$/)
  );
  const eightHoursInMs = 8 * 60 * 60 * 1000;

  cacheKeys.forEach((key) => {
    const cachedData = localStorage.getItem(key);
    if (cachedData) {
      const { timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp >= eightHoursInMs) {
        clearCache(key);
      }
    }
  });
}

function isPageDataValid() {
  const pageData = localStorage.getItem("wizz_page_data");
  if (pageData) {
    const data = JSON.parse(pageData);
    const eightHoursInMs = 8 * 60 * 60 * 1000;
    return Date.now() - data.timestamp < eightHoursInMs;
  }
  return false;
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM content loaded");
  checkCacheValidity();
  const checkFlightsButton = document.getElementById("search-flights");
  const routeListElement = document.querySelector(".route-list");
  const airportInput = document.getElementById("airport-input");
  const audioCheckbox = document.getElementById("play-audio-checkbox");

  audioCheckbox.addEventListener("change", () => {
    const existingPlayer = document.getElementById("background-music");
    if (existingPlayer) {
      existingPlayer.remove();
    }
  });

  const lastAirport = localStorage.getItem("lastAirport");
  if (lastAirport) {
    airportInput.value = lastAirport;
  }

  airportInput.addEventListener("input", () => {
    localStorage.setItem("lastAirport", airportInput.value.toUpperCase());
  });

  if (!routeListElement) {
    console.error("Error: .route-list element not found in the DOM");
  }

  if (checkFlightsButton) {
    console.log("Check Flights button found");
    checkFlightsButton.addEventListener("click", () => {
      console.log("Check Flights button clicked");

      if (audioCheckbox.checked) {
        const existingPlayer = document.getElementById("background-music");
        if (!existingPlayer) {
          const audioPlayer = document.createElement("audio");
          audioPlayer.id = "background-music";
          audioPlayer.controls = true;
          audioPlayer.loop = true;
          audioPlayer.style.position = "fixed";
          audioPlayer.style.bottom = "10px";
          audioPlayer.style.right = "10px";
          audioPlayer.style.transform = "none";
          audioPlayer.style.zIndex = "1000";
          audioPlayer.style.width = "150px";
          audioPlayer.style.height = "30px";
          audioPlayer.controlsList =
            "nodownload noplaybackrate nofullscreen noremoteplayback";
          audioPlayer.style.webkitMediaControls = "play current-time";

          const source = document.createElement("source");
          source.src = "assets/background-music.mp3";
          source.type = "audio/mpeg";

          audioPlayer.appendChild(source);
          document.body.appendChild(audioPlayer);
          audioPlayer.play();
        }
      }

      checkAllRoutes().catch((error) => {
        console.error("Error in checkAllRoutes:", error);
        if (routeListElement) {
          routeListElement.innerHTML = `<p>Error: ${error.message}</p>`;
        }
      });
    });
  } else {
    console.error("Check Flights button not found");
  }

  displayCacheButton();

  if (!isPageDataValid()) {
    localStorage.removeItem("wizz_page_data");
  }
});


function displayResults(flightsByDate, append = false) {
    const resultsDiv = document.querySelector('.route-list');
    if (!resultsDiv) return;

    if (!append) {
        resultsDiv.innerHTML = '';
    }

    for (const [date, flights] of Object.entries(flightsByDate)) {
        if (flights.length > 0) {
            const dateHeader = document.createElement('h3');
            dateHeader.textContent = `Flights on ${date}`;
            resultsDiv.appendChild(dateHeader);

            const flightList = document.createElement('ul');
            flightList.style.listStyleType = 'none';
            flightList.style.padding = '0';

            flights.forEach(flight => {
                const flightItem = document.createElement('li');
                flightItem.style.marginBottom = '15px';
                flightItem.style.padding = '10px';
                flightItem.style.border = '1px solid #ddd';
                flightItem.style.borderRadius = '5px';

                const routeDiv = document.createElement('div');
                routeDiv.textContent = `Route: ${flight.route}`;
                routeDiv.classList.add('route'); // Add class for easy selection
                routeDiv.style.fontWeight = 'bold';

                const dateDiv = document.createElement('div');
                dateDiv.textContent = `Date: ${flight.date}`;
                dateDiv.classList.add('date'); // Add class for easy selection

                const departureDiv = document.createElement('div');
                departureDiv.textContent = `Departure: ${flight.departure}`;
                departureDiv.classList.add('departure'); // Add class for easy selection

                const arrivalDiv = document.createElement('div');
                arrivalDiv.textContent = `Arrival: ${flight.arrival}`;
                arrivalDiv.classList.add('arrival'); // Add class for easy selection

                const durationDiv = document.createElement('div');
                durationDiv.textContent = `Duration: ${flight.duration}`;
                durationDiv.classList.add('duration'); // Add class for easy selection

                flightItem.appendChild(routeDiv);
                flightItem.appendChild(dateDiv);
                flightItem.appendChild(departureDiv);
                flightItem.appendChild(arrivalDiv);
                flightItem.appendChild(durationDiv);
                flightList.appendChild(flightItem);
            });

            resultsDiv.appendChild(flightList);
        }
    }
}

function saveResults(results) {
    localStorage.setItem('flightResults', JSON.stringify(results));
}

function loadResults() {
    const results = localStorage.getItem('flightResults');
    return results ? JSON.parse(results) : [];
}

document.addEventListener('DOMContentLoaded', () => {
    const savedResults = loadResults();
    if (savedResults.length > 0) {
        displayResults(savedResults);
    }
});

function getFlightData() {
    const flights = [];
    const flightElements = document.querySelectorAll('.route-list li');
    flightElements.forEach(flightElement => {
        const route = flightElement.querySelector('.route')?.textContent || 'N/A';
        const date = flightElement.querySelector('.date')?.textContent || 'N/A';
        const departure = flightElement.querySelector('.departure')?.textContent || 'N/A';
        const arrival = flightElement.querySelector('.arrival')?.textContent || 'N/A';
        const duration = flightElement.querySelector('.duration')?.textContent || 'N/A';

        flights.push({ route, date, departure, arrival, duration });
    });
    return flights;
}

// Function to export results to JSON
function exportToJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flight_results.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Function to export results to CSV
function exportToCsv(data) {
    const csv = data.map(flight => {
        return `${flight.route},${flight.date},${flight.departure},${flight.arrival},${flight.duration}`;
    }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flight_results.csv';
    a.click();
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
    // Existing code...

    // Add event listeners for export buttons
    document.getElementById('export-json').addEventListener('click', () => {
        const flightData = getFlightData(); // Replace with your function to get flight data
        exportToJson(flightData);
    });

    document.getElementById('export-csv').addEventListener('click', () => {
        const flightData = getFlightData(); // Replace with your function to get flight data
        exportToCsv(flightData);
    });
});


function computeDuration(departureTime, arrivalTime) {
    // Helper function to parse time and offset
    function parseTimeAndOffset(timeString) {
        // Example input: "10:00 (+02:00)"
        const [time, offset] = timeString.split(' ');
        const [hours, minutes] = time.split(':').map(Number);
        const [offsetHours, offsetMinutes] = offset.slice(1, -1).split(':').map(Number);
        return { hours, minutes, offsetHours, offsetMinutes };
    }

    // Parse departure and arrival times
    const departure = parseTimeAndOffset(departureTime);
    const arrival = parseTimeAndOffset(arrivalTime);

    // Convert departure and arrival times to UTC
    const departureUTC = new Date();
    departureUTC.setUTCHours(departure.hours - departure.offsetHours, departure.minutes - departure.offsetMinutes, 0, 0);

    const arrivalUTC = new Date();
    arrivalUTC.setUTCHours(arrival.hours - arrival.offsetHours, arrival.minutes - arrival.offsetMinutes, 0, 0);

    // Handle cases where the arrival is on the next day
    if (arrivalUTC < departureUTC) {
        arrivalUTC.setDate(arrivalUTC.getDate() + 1);
    }

    // Calculate the duration in milliseconds
    const durationMs = arrivalUTC - departureUTC;

    // Convert duration to hours and minutes
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    return `${durationHours}h ${durationMinutes}m`;
}
