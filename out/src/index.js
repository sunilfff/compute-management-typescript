"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const msRestAzure = require("ms-rest-azure");
const ComputeManagementClient = require("azure-arm-compute");
const StorageManagementClient = require("azure-arm-storage");
const NetworkManagementClient = require("azure-arm-network");
const AuthorizationManagementClient = require("azure-arm-authorization");
const azure_arm_resource_1 = require("azure-arm-resource");
class State {
    constructor() {
        this.clientId = process.env['CLIENT_ID'];
        this.domain = process.env['DOMAIN'];
        this.secret = process.env['APPLICATION_SECRET'];
        this.subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    }
}
class VMSample {
    constructor(state) {
        this.state = state;
        this.resourceGroupName = Helpers.generateRandomId('testrg');
        this.vmName = Helpers.generateRandomId('testvm');
        this.storageAccountName = Helpers.generateRandomId('testacc');
        this.vnetName = Helpers.generateRandomId('testvnet');
        this.subnetName = Helpers.generateRandomId('testsubnet');
        this.publicIPName = Helpers.generateRandomId('testpip');
        this.networkInterfaceName = Helpers.generateRandomId('testnic');
        this.ipConfigName = Helpers.generateRandomId('testcrpip');
        this.domainNameLabel = Helpers.generateRandomId('testdomainname');
        this.osDiskName = Helpers.generateRandomId('testosdisk');
        this.roleAssignmentName = Helpers.generateRandomId('testRole');
        this.location = 'westus';
        this.adminUserName = 'notadmin';
        this.adminPassword = 'Pa$$w0rd92234';
        this.ubuntuConfig = {
            publisher: 'Canonical',
            offer: 'UbuntuServer',
            sku: '16.04.0-LTS',
            osType: 'Linux'
        };
    }
    execute() {
        msRestAzure
            .loginWithServicePrincipalSecret(this.state.clientId, this.state.secret, this.state.domain, this.state.options)
            .then((credentials) => {
            this.resourceClient = new azure_arm_resource_1.ResourceManagementClient(credentials, this.state.subscriptionId);
            this.computeClient = new ComputeManagementClient(credentials, this.state.subscriptionId);
            this.storageClient = new StorageManagementClient(credentials, this.state.subscriptionId);
            this.networkClient = new NetworkManagementClient(credentials, this.state.subscriptionId);
            this.authorizationClient = new AuthorizationManagementClient(credentials, this.state.subscriptionId);
            this.createVM()
                .then((vm) => console.log(`VM creation successful: ${JSON.stringify(vm)}`));
        })
            .catch((error) => console.log(`Error occurred: ${error}`));
    }
    createVM() {
        return this.createResourceGroup()
            .then((rg) => {
            let storageTask = this.createStorageAccount();
            let subnetTask = this.createVnet();
            let nicTask = subnetTask.then(() => this.createNIC());
            let vmTask = Promise.all([storageTask, subnetTask, nicTask])
                .then(() => this.createVirtualMachine());
            vmTask.then((vm) => this.FinalizeMSISetup(rg, vm));
            return vmTask;
        });
    }
    createResourceGroup() {
        let groupParameters = {
            location: this.location
        };
        console.log(`\n1.Creating resource group: ${this.resourceGroupName}`);
        return this.resourceClient.resourceGroups.createOrUpdate(this.resourceGroupName, groupParameters);
    }
    createStorageAccount() {
        let storageAcctParams = {
            location: this.location,
            sku: {
                name: 'Standard_LRS',
            },
            kind: 'storage',
        };
        console.log(`\n2.Creating storage account: ${this.storageAccountName}`);
        return this.storageClient.storageAccounts.create(this.resourceGroupName, this.storageAccountName, storageAcctParams);
    }
    createVnet() {
        let vnetParams = {
            location: this.location,
            addressSpace: {
                addressPrefixes: ['10.0.0.0/16']
            },
            dhcpOptions: {
                dnsServers: ['10.1.1.1', '10.1.2.4']
            },
            subnets: [{ name: this.subnetName, addressPrefix: '10.0.0.0/24' }],
        };
        console.log(`\n3.Creating vnet: ${this.vnetName}`);
        return this.networkClient.virtualNetworks.createOrUpdate(this.resourceGroupName, this.vnetName, vnetParams);
    }
    getSubnetInfo() {
        return this.networkClient.subnets.get(this.resourceGroupName, this.vnetName, this.subnetName);
    }
    createPublicIP() {
        let publicIPParameters = {
            location: this.location,
            publicIPAllocationMethod: 'Dynamic',
            dnsSettings: {
                domainNameLabel: this.domainNameLabel
            }
        };
        console.log(`\n4.Creating public IP: ${this.publicIPName}`);
        return this.networkClient.publicIPAddresses.createOrUpdate(this.resourceGroupName, this.publicIPName, publicIPParameters);
    }
    createNIC() {
        let subnetTask = this.getSubnetInfo();
        let ipTask = this.createPublicIP();
        return Promise.all([subnetTask, ipTask])
            .then(([s, ip]) => {
            console.log(`\n5.Creating Network Interface: ${this.networkInterfaceName}`);
            let subnet = s;
            let publicIp = ip;
            let nicParameters = {
                location: this.location,
                ipConfigurations: [
                    {
                        name: this.ipConfigName,
                        privateIPAllocationMethod: 'Dynamic',
                        subnet: subnet,
                        publicIPAddress: publicIp
                    }
                ]
            };
            return this.networkClient.networkInterfaces.createOrUpdate(this.resourceGroupName, this.networkInterfaceName, nicParameters);
        });
    }
    findVMImage() {
        return this.computeClient.virtualMachineImages.list(this.location, this.ubuntuConfig.publisher, this.ubuntuConfig.offer, this.ubuntuConfig.sku, { top: 1 });
    }
    getNICInfo() {
        return this.networkClient.networkInterfaces.get(this.resourceGroupName, this.networkInterfaceName);
    }
    createVirtualMachine() {
        let nicTask = this.getNICInfo();
        let findVMTask = this.findVMImage();
        return Promise.all([nicTask, findVMTask])
            .then(([nic, img]) => {
            let nicId = nic.id;
            let vmImageVersionNumber = img[0].name;
            let osProfile = {
                computerName: this.vmName,
                adminUsername: this.adminUserName,
                adminPassword: this.adminPassword
            };
            let hardwareProfile = {
                vmSize: 'Basic_A0'
            };
            let imageReference = {
                publisher: this.ubuntuConfig.publisher,
                offer: this.ubuntuConfig.offer,
                sku: this.ubuntuConfig.sku,
                version: vmImageVersionNumber
            };
            let osDisk = {
                name: this.osDiskName,
                caching: 'None',
                createOption: 'fromImage',
            };
            let storageProfile = {
                imageReference: imageReference,
                osDisk: osDisk
            };
            let networkProfile = {
                networkInterfaces: [
                    {
                        id: nicId,
                        primary: true
                    }
                ]
            };
            let identity = {
                type: "SystemAssigned"
            };
            let vmParameters = {
                location: this.location,
                osProfile: osProfile,
                hardwareProfile: hardwareProfile,
                storageProfile: storageProfile,
                networkProfile: networkProfile,
                identity: identity
            };
            console.log(`\n6.Creating Virtual Machine: ${this.vmName}`);
            return this.computeClient.virtualMachines.createOrUpdate(this.resourceGroupName, this.vmName, vmParameters);
        });
    }
    FinalizeMSISetup(rg, vm) {
        let msiPrincipalId = vm.identity.principalId;
        let roleName = "Contributor";
        let self = this;
        let rolesTask = this.authorizationClient.roleDefinitions.list(rg.id, { filter: `roleName eq ${roleName}` });
        let assignRoleTask = rolesTask.then(function assignRole(roles) {
            let contributorRole = roles[0];
            let roleAssignmentParams = {
                principalId: msiPrincipalId,
                roleDefinitionId: contributorRole.id
            };
            return self.authorizationClient.roleAssignments.create(rg.id, self.roleAssignmentName, roleAssignmentParams);
        });
        let installMSITask = assignRoleTask.then(function installMSIExtension(role) {
            let extensionName = "msiextension";
            let extension = {
                publisher: "Microsoft.ManagedIdentity",
                virtualMachineExtensionType: "ManagedIdentityExtensionForLinux",
                typeHandlerVersion: "1.0",
                autoUpgradeMinorVersion: true,
                settings: {
                    port: "50342",
                },
                location: self.location
            };
            return self.computeClient.virtualMachineExtensions.createOrUpdate(self.resourceGroupName, self.vmName, extensionName, extension);
        });
        let publicIPTask = this.networkClient.publicIPAddresses.get(this.resourceGroupName, this.publicIPName);
        publicIPTask.then(function printConnInfo(publicIp) {
            console.log("you can connect to the VM using:");
            console.log(`ssh ${self.adminUserName}@${publicIp.ipAddress}. The password is ${self.adminPassword}`);
        });
        return installMSITask;
    }
}
class Helpers {
    static generateRandomId(prefix) {
        return prefix + Math.floor(Math.random() * 10000);
    }
    static validateEnvironmentVariables() {
        let envs = [];
        if (!process.env['CLIENT_ID'])
            envs.push('CLIENT_ID');
        if (!process.env['DOMAIN'])
            envs.push('DOMAIN');
        if (!process.env['APPLICATION_SECRET'])
            envs.push('APPLICATION_SECRET');
        if (!process.env['AZURE_SUBSCRIPTION_ID'])
            envs.push('AZURE_SUBSCRIPTION_ID');
        if (envs.length > 0) {
            throw new Error(`please set/export the following environment variables: ${envs.toString()}`);
        }
    }
}
main();
function main() {
    Helpers.validateEnvironmentVariables();
    let state = new State();
    let driver = new VMSample(state);
    driver.execute();
}
//# sourceMappingURL=index.js.map