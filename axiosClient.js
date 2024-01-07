const axios = require('axios');

const axiosClient = axios.create({
    baseURL: 'https://6hvjwmwdp4wfznzh4evxqntkmq0ilmlh.lambda-url.ap-south-1.on.aws/femto',
    withCredentials: false,
});

module.exports = axiosClient;