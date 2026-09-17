import axios from "axios";

const API = axios.create({
  baseURL: "http://127.0.0.1:8000",
});

export const getCentres = () => API.get("/centres");

export const getFarmers = () => API.get("/farmers");

export const createFarmer = (data) =>
  API.post("/farmers", data);

export const updateFarmer = (id, data) =>
  API.put(`/farmers/${id}`, data);


export const createCentre = (data) =>
  API.post("/centres", data);

export const createAppointment = (data) =>
  API.post("/appointments", data);

export const getAppointments = () =>
  API.get("/appointments");

export const updateAppointmentStatus = (id, status) =>
  API.put(`/appointments/${id}/status`, null, {
    params: { status },
  });

  export const deleteFarmer = (id) =>
  API.delete(`/farmers/${id}`);

export const deleteAppointment = (id) =>
  API.delete(`/appointments/${id}`);

export const deleteCentre = (id) =>
  API.delete(`/centres/${id}`);

export const getProcurements = () =>
  API.get("/procurements");

export const updateCentre = (id, data) =>
  API.put(`/centres/${id}`, data);

export default API;